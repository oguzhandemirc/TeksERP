// =============================================================================
// test_devere_planlama_bagi — fason devere D8: çözgü ihtiyacı → devere siparişi önerisi (`GET /api/warp-plan/need`)
// =============================================================================
//   §0 statik: servis take-up'ı `warpRequirements`/`warpNeedM`ten, tahsisi `beamNeeds`ten, arzı `readWarpSupplyBySpec`ten
//      alır — formül kopyası yok; route'ta prisma yok
//   §1 kumaş metresi (S-D8-1/8): zemin 1000 ÷ 0,9 = 1111,111 → 3 × 500 · SEPARATE döner 1250 → 3 × 500 · SHARED/CREEL önerisiz
//   §2 stok (S-D8-2) · §3 PLANNED levent (S-D8-4) · §4 açık devere siparişi düşer → eksik 0, öneri yok (S-D8-3/10)
//   §5 kısmi dönüş: levent stoğa geçer, sipariş kalanı düşer — toplam arz DEĞİŞMEZ (çift sayım yok)
//   §6 önce açık dokuma işleri tüketir; yeni talep yalnız serbest arzı görür (S-D8-5)
//   §7 dokuma işi kaynağı kendi sırasıyla (S-D8-6) · kapalı iş uyarı · bilinmeyen 404
//   §8 sipariş kaynağı: üretim önerisinin plan metresi + müşteri siparişi bağı
//   §9 devere kapalı → 403 MODULE_DISABLED (`details.code`) · dokuma kapalı → dokuma kaynakları 403, kumaş çalışır (S-D8-7)
// Negatif sondalar (koşuldu, PR gövdesinde): (A) arzdan açık devere kalanı çıkarılınca §4 kırmızı; (B) take-up yerine
// kumaş metresi kullanılınca §1 kırmızı; (C) servis içi devere kapısı kaldırılınca §9a kırmızı.
// Çalıştır: npx tsx scripts/test_devere_planlama_bagi.ts (yalnız test DB; global ayar yazar → hedefDbEngeli)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { computeWarpNeed, type WarpNeedInput, type WarpNeedRow } from "../src/services/warp-need.service";
import { buildProductionProposal } from "../src/services/helpers/production-proposal.helper";
import { warpNeedM } from "../src/services/helpers/beam-need.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-DVD8-${Date.now().toString(36).toUpperCase()}`;
const KEYS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const saved = new Map<string, unknown>();
const made = { items: [] as string[], specs: [] as string[], beams: [] as string[], weaving: [] as string[], warping: [] as string[], customer: "" };
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

async function need(input: WarpNeedInput) {
  return (await computeWarpNeed(input)).data!;
}
const rowOf = (rows: WarpNeedRow[], specId: string) => rows.find((r) => r.warpSpecId === specId);
const errOf = (p: Promise<unknown>) => p.then(() => "OK", (e: { statusCode?: number; details?: { code?: string } }) => `${e.statusCode}:${e.details?.code ?? ""}`);

function statik(): void {
  const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\/.*$/gm, "");
  const svc = read("services", "warp-need.service.ts");
  const sup = read("services", "helpers", "warp-supply.helper.ts");
  check("§0a servis gereksinimi `warpRequirements`, tahsisi `beamNeeds`, arzı `readWarpSupplyBySpec`ten alır", /warpRequirements\(/.test(svc) && /beamNeeds\(/.test(svc) && /readWarpSupplyBySpec\(/.test(svc));
  check("§0b take-up formülü kopyalanmaz (servis/arz helper'ında `takeUpPct /` yok)", !/takeUpPct\s*\//.test(svc + sup) && !/1\s*-\s*takeUp/.test(svc + sup));
  check("§0c arz stoğu `readBeamStockBySpec` tek kaynağından", /readBeamStockBySpec\(/.test(sup));
  check("§0d route prisma import etmez", !/lib\/prisma/.test(read("routes", "warp-plan.routes.ts")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== FASON DEVERE D8 — PLANLAMA BAĞI ===\n");
  statik();
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, false);
  await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, false);

  const U = await testActorId();
  const sub = await ensureTestDyeHouse();
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } });
  made.items.push(yarn.id);
  const spec = async (s: string, takeUpPct: number) => {
    const r = await prisma.warpSpec.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, yarnItemId: yarn.id, endsCount: 3000, takeUpPct }, select: { id: true } });
    made.specs.push(r.id);
    return r.id;
  };
  const G = await spec("G", 10), L = await spec("L", 20), S = await spec("S", 10), K = await spec("K", 5);
  const fabric = async (s: string, layers: Parameters<typeof replaceItemWarpLayers>[1], beamLengthM: number | null) => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC", warpSpecId: G, widthCm: 300 }, select: { id: true } })).id;
    made.items.push(id);
    if (layers.length) await replaceItemWarpLayers(id, layers);
    if (beamLengthM) await prisma.costStructure.create({ data: { itemId: id, beamLengthM } });
    return id;
  };
  const F1 = await fabric("F1", [
    { warpSpecId: L, role: "LENO", beamMode: "SEPARATE_BEAM" },
    { warpSpecId: S, role: "SECONDARY", beamMode: "SHARED_BEAM" },
    { warpSpecId: K, role: "SECONDARY", beamMode: "CREEL" },
  ], 500);
  const F2 = await fabric("F2", [], 500);
  const beam = async (lengthM: number, wind: boolean) => {
    const p = await createWarpBeam({ warpSpecId: G, plannedLengthM: lengthM, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    made.beams.push(p.data.id);
    if (wind) await windWarpBeam(p.data.id, { lengthM, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };

  console.log("── §1 Kumaş metresi → çözgü (take-up) ──");
  const r1 = await need({ source: "FABRIC", itemId: F1, fabricM: 1000 });
  const g1 = rowOf(r1.rows, G), l1 = rowOf(r1.rows, L), s1 = rowOf(r1.rows, S), k1 = rowOf(r1.rows, K);
  check("§1a ⭐ zemin 1000 ÷ 0,9 = 1111,111 m (take-up), arz 0 → eksik 1111,111", g1?.requiredM === 1111.111 && g1.shortfallM === 1111.111 && g1.supply?.totalM === 0, `${g1?.requiredM}/${g1?.shortfallM}`);
  check("§1b ⭐ öneri levent boyuna yukarı: 3 × 500 = 1500 m", g1?.suggestion?.beamCount === 3 && g1.suggestion.beamLengthM === 500 && g1.suggestion.totalM === 1500, JSON.stringify(g1?.suggestion));
  check("§1c SEPARATE_BEAM döner kendi satırı: 1000 ÷ 0,8 = 1250 → 3 × 500", l1?.ownBeam === true && l1.requiredM === 1250 && l1.suggestion?.beamCount === 3);
  check("§1d SHARED_BEAM zemin leventinde, CREEL leventsiz — öneri yok", s1?.ownBeam === false && s1.suggestion === null && k1?.beamMode === "CREEL" && k1.suggestion === null);
  check("§1e kaynak etiketi + uyarısız", r1.source === "FABRIC" && r1.warnings.length === 0 && r1.salesOrder === null);

  console.log("\n── §2–§5 Arz düşümü ──");
  await beam(500, true);
  const g2 = rowOf((await need({ source: "FABRIC", itemId: F1, fabricM: 1000 })).rows, G);
  check("§2 ⭐ hazır levent 500 m düşer → eksik 611,111 → 2 × 500", g2?.supply?.stockM === 500 && g2.shortfallM === 611.111 && g2.suggestion?.beamCount === 2, `${g2?.supply?.stockM}/${g2?.shortfallM}`);
  await beam(200, false);
  const g3 = rowOf((await need({ source: "FABRIC", itemId: F1, fabricM: 1000 })).rows, G);
  check("§3 ⭐ PLANNED levent 200 m düşer → eksik 411,111 → 1 × 500", g3?.supply?.plannedBeamM === 200 && g3.shortfallM === 411.111 && g3.suggestion?.beamCount === 1, `${g3?.supply?.plannedBeamM}/${g3?.shortfallM}`);
  const wo = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: G, beamLines: [{ beamCount: 2, beamLengthM: 300 }] }, U);
  made.warping.push(wo.data.id);
  const r4 = await need({ source: "FABRIC", itemId: F1, fabricM: 1000 });
  const g4 = rowOf(r4.rows, G);
  check("§4a ⭐ açık devere siparişi kalanı 600 m düşer → eksik 0, öneri YOK (çift sipariş önerilmez)", g4?.supply?.openWarpingM === 600 && g4.shortfallM === 0 && g4.suggestion === null, `${g4?.supply?.openWarpingM}/${g4?.shortfallM}`);
  check("§4b açık sipariş listelenir + son devereci ön dolum için döner", g4?.openWarpingOrders.some((o) => o.id === wo.data.id && o.remainingM === 600) === true && g4?.subcontractor?.id === sub.id);
  const before = g4?.supply?.totalM;
  const recv = await beam(250, true);
  await prisma.warpBeam.update({ where: { id: recv }, data: { warpingOrderId: wo.data.id, warpingReceiptKey: randomUUID() } });
  const g5 = rowOf((await need({ source: "FABRIC", itemId: F1, fabricM: 1000 })).rows, G);
  check("§5 ⭐ kısmi dönüş 250 m: stok 750, sipariş kalanı 350, toplam arz aynı (çift sayım yok)", g5?.supply?.stockM === 750 && g5.supply.openWarpingM === 350 && g5.supply.totalM === before, JSON.stringify(g5?.supply));

  console.log("\n── §6–§7 Açık dokuma işleri önce tüketir ──");
  // Arz 1300 m. A (önce) 900 m kumaş → 1000 m çözgü; B (sonra) 450 m → 500 m çözgü.
  const mkWo = async (s: string, itemId: string, plannedM: number, day: string, status: "PLANNED" | "COMPLETED" = "PLANNED") => {
    const r = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-${s}`, itemId, warpSpecId: G, executionKind: "IN_HOUSE", plannedM, plannedStartDate: new Date(day), status, ...(status === "COMPLETED" ? { closedAt: new Date() } : {}) }, select: { id: true } });
    made.weaving.push(r.id);
    return r.id;
  };
  const A = await mkWo("A", F2, 900, "2026-01-01T09:00:00Z");
  const B = await mkWo("B", F2, 450, "2026-01-02T09:00:00Z");
  const g6 = rowOf((await need({ source: "FABRIC", itemId: F1, fabricM: 1000 })).rows, G);
  check("§6 ⭐ yeni talep yalnız serbest arzı görür: arzın tamamı (1300) A + B işlerine ayrılır, serbest 0, eksik 1111,111", g6?.committedM === 1300 && g6.freeM === 0 && g6.shortfallM === 1111.111, `${g6?.committedM}/${g6?.freeM}/${g6?.shortfallM}`);
  const rA = await need({ source: "WEAVING_ORDER", weavingOrderId: A });
  const rB = await need({ source: "WEAVING_ORDER", weavingOrderId: B });
  const gA = rowOf(rA.rows, G), gB = rowOf(rB.rows, G);
  check("§7a ⭐ A (öncelikli) tüm arzı görür: gerekli 1000, serbest 1300, eksik 0", gA?.requiredM === 1000 && gA.freeM === 1300 && gA.shortfallM === 0 && gA.committedM === 0, `${gA?.freeM}/${gA?.shortfallM}`);
  check("§7b ⭐ B kendi sırasında: A'ya ayrılan 1000, serbest 300, eksik 200 → 1 × 500", gB?.requiredM === 500 && gB.committedM === 1000 && gB.freeM === 300 && gB.shortfallM === 200 && gB.suggestion?.beamCount === 1, `${gB?.committedM}/${gB?.freeM}/${gB?.shortfallM}`);
  check("§7c kaynak etiketi dokuma iş emri numarası", rB.source === "WEAVING_ORDER" && rB.sourceLabel.includes(`${TAG}-B`));
  const C = await mkWo("C", F2, 400, "2026-01-03T09:00:00Z", "COMPLETED");
  const rC = await need({ source: "WEAVING_ORDER", weavingOrderId: C });
  check("§7d kapalı iş: öneri yok + WEAVING_ORDER_CLOSED uyarısı", rC.rows.length === 0 && rC.warnings.some((w) => w.code === "WEAVING_ORDER_CLOSED"));
  check("§7e bilinmeyen dokuma işi 404", (await errOf(need({ source: "WEAVING_ORDER", weavingOrderId: randomUUID() }))).startsWith("404"));

  console.log("\n── §8 Sipariş kaynağı ──");
  const admin = await ensureTestAdmin();
  made.customer = (await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} müşteri` }, select: { id: true } })).id;
  const orders = (await import("../src/routes/order.routes")).orderService;
  const ord = (await orders.create({ customerId: made.customer, currency: "TRY", clientToken: randomUUID(), lines: [{ itemId: F2, quantity: 600, unitPrice: 1 }] }, admin.id)) as { data: { id: string } };
  await prisma.order.update({ where: { id: ord.data.id }, data: { status: "APPROVED" } });
  const pp = await buildProductionProposal(prisma, ord.data.id, { weaving: true, workOrder: false });
  const plannedM = pp.weavingOrders.find((w) => w.itemId === F2)?.plannedM ?? null;
  const r8 = await need({ source: "ORDER", orderId: ord.data.id });
  const g8 = rowOf(r8.rows, G);
  check("§8a ⭐ sipariş kaynağı üretim önerisinin plan metresiyle: çözgü = warpNeedM(plan, %10)", plannedM !== null && g8?.fabricM === plannedM && g8.requiredM === warpNeedM(plannedM, 10), `${plannedM} → ${g8?.requiredM}`);
  check("§8b açık dokuma işleri arzı tüketmiş: serbest 0, eksik = gerekli; müşteri siparişi bağı döner", g8?.freeM === 0 && g8.shortfallM === g8.requiredM && r8.salesOrder?.id === ord.data.id);

  console.log("\n── §9 Rejim kapıları ──");
  await setSetting(SETTING_KEYS.DOKUMA_ENABLED, false);
  check("§9a dokuma kapalı → dokuma işi kaynağı 403 MODULE_DISABLED", (await errOf(need({ source: "WEAVING_ORDER", weavingOrderId: A }))) === "403:MODULE_DISABLED");
  const r9 = await need({ source: "FABRIC", itemId: F1, fabricM: 1000 });
  check("§9b dokuma kapalı → kumaş kaynağı çalışır, açık işler sayılmaz (serbest = arz)", rowOf(r9.rows, G)?.freeM === 1300);
  await setSetting(SETTING_KEYS.DOKUMA_ENABLED, true);
  await setSetting(SETTING_KEYS.DEVERE_ENABLED, false);
  check("§9c ⭐ devere kapalı → 403 MODULE_DISABLED (`details.code`), öneri yok", (await errOf(need({ source: "FABRIC", itemId: F1, fabricM: 1000 }))) === "403:MODULE_DISABLED");
}

async function cleanup(): Promise<void> {
  const t = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  if (made.customer) {
    await t(() => prisma.orderLine.deleteMany({ where: { order: { customerId: made.customer } } }));
    await t(() => prisma.order.deleteMany({ where: { customerId: made.customer } }));
    await t(() => prisma.customer.deleteMany({ where: { id: made.customer } }));
  }
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: made.weaving } } }));
  await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } }));
  await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } }));
  await t(() => prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: made.warping } } }));
  await t(() => prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: made.warping } } }));
  await t(() => prisma.warpingOrder.deleteMany({ where: { id: { in: made.warping } } }));
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.beams, ...made.items, ...made.warping, ...made.weaving] } } }));
  await t(() => prisma.costStructure.deleteMany({ where: { itemId: { in: made.items } } }));
  await t(() => prisma.itemWarpLayer.deleteMany({ where: { itemId: { in: made.items } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: made.items } }, data: { warpSpecId: null } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { id: { in: made.specs } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: made.items } } }));
  for (const [key, value] of saved) {
    if (value === undefined) await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
    else await t(() => setSetting(key, value));
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
