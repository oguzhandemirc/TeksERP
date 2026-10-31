// =============================================================================
// test_uretim_onerisi — SY-M1: siparişten üretim önerisi (önizleme + uygula + token/kilit)
// =============================================================================
//   §0 ayar KAPALI (varsayılan) → önizleme 403 PRODUCTION_PROPOSAL_DISABLED (bugünkü davranış: uç yok)
//   §1 önizleme: dokuma işi grubu (ürün+varyant), ham ihtiyaç = açık m ÷ (1 − çekme); iş emri grubu (ürün+renk+en), rota varyanttan
//   §2 ⭐ aynı token iki istek → TEK kayıt seti + replay (idempotentReplay, aynı id'ler, sayım değişmez)
//   §3 bağlı satır öneriden düşer (ORDER_LINE_ALREADY_PLANNED)
//   §4 ⭐ eşzamanlı FARKLI token'lı uygula → tek dokuma işi; kaybedenler 409 ORDER_LINE_ALREADY_PLANNED
//      (negatif sonda: `lockOrderLinesTx` FOR UPDATE'i kaldırılınca çift dokuma işi doğar)
//   §5 bayat seçim 409 PROPOSAL_STALE · yazma izni yoksa 403 (anahtar-kapsamlı)
// Çalıştır: npx tsx scripts/test_uretim_onerisi.ts (yalnız test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyProductionProposal, previewProductionProposal, type ProposalAccess } from "../src/services/production-proposal.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-SYM1-${Date.now().toString(36).toUpperCase()}`;
const FULL: ProposalAccess = { readWeaving: true, writeWeaving: true, writeWorkOrder: true };
const KEYS = [SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED];
const saved = new Map<string, unknown>();
const made = { customer: "", items: [] as string[], weft: "", station: "", route: "", recipe: "", rate: "" };

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) { return String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message); }
}

async function fixtures(adminId: string) {
  made.customer = (await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} müşteri` }, select: { id: true } })).id;
  const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
  made.items.push(yarn.id);
  made.weft = (await prisma.weftSpec.create({ data: { code: `${TAG}-W`, name: `${TAG} atkı`, picksPerCm: "20", yarns: { create: [{ yarnItemId: yarn.id, picksInRepeat: 4, sortOrder: 0 }] } }, select: { id: true } })).id;
  const item = await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} tül`, itemType: "FABRIC", weftSpecId: made.weft }, select: { id: true } });
  made.items.push(item.id);
  made.station = (await prisma.station.create({ data: { code: `${TAG}-BY`.slice(0, 32), name: `${TAG} Boya`, type: "INTERNAL" }, select: { id: true } })).id;
  made.route = (await prisma.route.create({ data: { name: `${TAG} rota`, steps: { create: [{ stationId: made.station, sequence: 1 }] } }, select: { id: true } })).id;
  made.rate = (await prisma.finishingRate.create({ data: { code: `${TAG}-FR`.slice(0, 32), name: `${TAG} boya`, basis: "RAW_M", currency: "TRY", pricePerM: "1", typicalShrinkPct: "10" }, select: { id: true } })).id;
  made.recipe = (await prisma.productRecipe.create({ data: { code: `${TAG}-R`.slice(0, 32), name: `${TAG} V01`, itemId: item.id, variantCode: "V01", routeId: made.route, finishingRateCode: `${TAG}-FR`.slice(0, 32) }, select: { id: true } })).id;
  const orders = (await import("../src/routes/order.routes")).orderService;
  const order = async (n: number): Promise<string> => {
    const lines = Array.from({ length: n }, () => ({ itemId: item.id, recipeId: made.recipe, quantity: 1000, unitPrice: 1 }));
    const r = (await orders.create({ customerId: made.customer, currency: "TRY", clientToken: randomUUID(), lines }, adminId)) as { data: { id: string } };
    await prisma.order.update({ where: { id: r.data.id }, data: { status: "APPROVED" } });
    return r.data.id;
  };
  return { itemId: item.id, order };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  const admin = await ensureTestAdmin();
  await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await setSetting(SETTING_KEYS.DOKUMA_ENABLED, true);
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL } });
  const { order } = await fixtures(admin.id);
  const o1 = await order(2);

  check("§0 ayar yokken (KAPALI) önizleme 403 PRODUCTION_PROPOSAL_DISABLED", (await codeOf(previewProductionProposal(o1, FULL))) === "PRODUCTION_PROPOSAL_DISABLED");
  await setSetting(SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, "ONIZLEME");

  const p1 = (await previewProductionProposal(o1, FULL)).data!;
  const wg = p1.weavingOrders[0];
  const og = p1.workOrders[0];
  check("§1a tek dokuma işi grubu, iki satır, varyant + atkı kartı dolu", p1.weavingOrders.length === 1 && wg?.orderLines.length === 2 && wg.recipeId === made.recipe && wg.weftSpecId === made.weft, JSON.stringify(wg));
  check("§1b ham ihtiyaç = 2 × 1000 ÷ 0,9 (çekme %10)", wg?.plannedM === 2222.222 && wg.shrinkPct === 10, String(wg?.plannedM));
  check("§1c tek iş emri grubu, rota varyanttan, seçilebilir", p1.workOrders.length === 1 && og?.routeId === made.route && og.blockedCode === null && og.targetQuantity === 2000, JSON.stringify(og));

  const body = {
    clientToken: randomUUID(),
    weavingOrders: [{ key: wg!.key, orderLineIds: wg!.orderLines.map((l) => l.orderLineId), plannedM: wg!.plannedM }],
    workOrders: [{ key: og!.key, orderLineIds: og!.orderLines.map((l) => l.orderLineId) }],
  };
  const a1 = await applyProductionProposal(o1, body, FULL, admin.id);
  const a2 = await applyProductionProposal(o1, body, FULL, admin.id);
  const lineIds = body.weavingOrders[0]!.orderLineIds;
  const wCount = await prisma.weavingOrder.count({ where: { orderLineLinks: { some: { orderLineId: { in: lineIds } } } } });
  const woCount = await prisma.workOrder.count({ where: { orderLinks: { some: { orderLineId: { in: lineIds } } } } });
  check("§2a ilk uygula 1 dokuma işi + 1 iş emri yaratır", a1.data!.weavingOrders.length === 1 && a1.data!.workOrders.length === 1 && !a1.idempotentReplay);
  check("§2b ⭐ aynı token → replay, aynı id'ler, sayım 1/1", a2.idempotentReplay === true && a2.data!.weavingOrders[0]?.id === a1.data!.weavingOrders[0]?.id
    && a2.data!.workOrders[0]?.id === a1.data!.workOrders[0]?.id && wCount === 1 && woCount === 1, `w=${wCount} wo=${woCount}`);
  const wo = await prisma.weavingOrder.findUniqueOrThrow({ where: { id: a1.data!.weavingOrders[0]!.id }, select: { recipeId: true, weftSpecId: true, plannedM: true } });
  check("§2c dokuma işi varyant + etkin atkı kartı + plan metresiyle doğar", wo.recipeId === made.recipe && wo.weftSpecId === made.weft && Number(wo.plannedM) === 2222.222, JSON.stringify(wo));

  const p3 = (await previewProductionProposal(o1, FULL)).data!;
  check("§3 bağlı satırlar öneriden düşer (ORDER_LINE_ALREADY_PLANNED, iki tür × iki satır)", p3.weavingOrders.length === 0 && p3.workOrders.length === 0
    && p3.excluded.filter((e) => e.code === "ORDER_LINE_ALREADY_PLANNED").length === 4, JSON.stringify(p3.excluded));

  const o2 = await order(2);
  const p4 = (await previewProductionProposal(o2, FULL)).data!;
  const sel = { key: p4.weavingOrders[0]!.key, orderLineIds: p4.weavingOrders[0]!.orderLines.map((l) => l.orderLineId), plannedM: 500 };
  const race = await Promise.all([1, 2, 3, 4].map(() => codeOf(applyProductionProposal(o2, { clientToken: randomUUID(), weavingOrders: [sel], workOrders: [] }, FULL, admin.id))));
  const raced = await prisma.weavingOrder.count({ where: { orderLineLinks: { some: { orderLineId: { in: sel.orderLineIds } } } } });
  check("§4 ⭐ eşzamanlı dört farklı token → tek dokuma işi, üç 409 ORDER_LINE_ALREADY_PLANNED", raced === 1 && race.filter((c) => c === "OK").length === 1
    && race.filter((c) => c === "ORDER_LINE_ALREADY_PLANNED").length === 3, `dokuma işi=${raced} sonuçlar=${race.join(",")}`);

  const o3 = await order(2);
  const p5 = (await previewProductionProposal(o3, FULL)).data!;
  const g5 = p5.weavingOrders[0]!;
  const stale = { clientToken: randomUUID(), weavingOrders: [{ key: g5.key, orderLineIds: [g5.orderLines[0]!.orderLineId], plannedM: 100 }], workOrders: [] };
  check("§5a eksik satırlı seçim → 409 PROPOSAL_STALE", (await codeOf(applyProductionProposal(o3, stale, FULL, admin.id))) === "PROPOSAL_STALE");
  const noWrite = { ...FULL, writeWeaving: false };
  const full5 = { clientToken: randomUUID(), weavingOrders: [{ key: g5.key, orderLineIds: g5.orderLines.map((l) => l.orderLineId), plannedM: 100 }], workOrders: [] };
  check("§5b dokuma yazma izni yok → 403 PERMISSION_DENIED; önizlemede canCreate.weaving=false",
    (await codeOf(applyProductionProposal(o3, full5, noWrite, admin.id))) === "PERMISSION_DENIED" && (await previewProductionProposal(o3, noWrite)).data!.canCreate.weaving === false);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  const lineWhere = { orderLine: { order: { customerId: made.customer } } };
  const wIds = (await prisma.weavingOrderToOrderLine.findMany({ where: lineWhere, select: { weavingOrderId: true } })).map((r) => r.weavingOrderId);
  const woIds = (await prisma.workOrderToOrderLine.findMany({ where: lineWhere, select: { workOrderId: true } })).map((r) => r.workOrderId);
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...wIds, ...woIds] } } }));
  await t(() => prisma.recordFollow.deleteMany({ where: { OR: [{ weavingOrderId: { in: wIds } }, { workOrderId: { in: woIds } }] } }));
  await t(() => prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: wIds } } }));
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: wIds } } }));
  await t(() => prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await t(() => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await t(() => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await t(() => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }));
  await t(() => prisma.orderLine.deleteMany({ where: { order: { customerId: made.customer } } }));
  await t(() => prisma.order.deleteMany({ where: { customerId: made.customer } }));
  await t(() => prisma.productRecipe.deleteMany({ where: { id: made.recipe } }));
  await t(() => prisma.finishingRate.deleteMany({ where: { id: made.rate } }));
  await t(() => prisma.route.deleteMany({ where: { id: made.route } }));
  await t(() => prisma.station.deleteMany({ where: { id: made.station } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: made.items } }, data: { weftSpecId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: made.weft } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: made.weft } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: made.items } } }));
  await t(() => prisma.customer.deleteMany({ where: { id: made.customer } }));
  for (const [key, value] of saved) {
    await t(() => (value === undefined ? prisma.systemSetting.deleteMany({ where: { key } }) : setSetting(key, value)));
  }
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    if (made.customer) await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
