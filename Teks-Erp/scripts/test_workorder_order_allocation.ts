// =============================================================================
// BEKÇİ — İŞ EMRİ METRESİNİ SİPARİŞ BAĞLARINA PAYLAŞTIRMA (2026-11-19)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_workorder_order_allocation
// =============================================================================
// Tek kaynak `services/helpers/order-link-allocation.helper.ts`; uç
// `PUT /api/work-orders/:id/order-links/allocations` (`workorder:write`).
//  §1 Tavan: top yokken hedef metre (TARGET), top girince giren ham metre (INPUT); detayda `allocation`
//  §2 1000 m giren, iki satır: 800+200 kabul · 800+300 → 400 ALLOCATION_OVER_BASIS, yazım geri alınır
//  §3 Kısmi gönderim korunur · defter FIELD_CHANGED `orderAllocation` · aynı değer yazmaz
//  §4 Düzenle (replace, yalnız orderLineIds) paylaştırmayı EZMEZ
//  §5 Tambur bağlamı `plannedQty` (paylaştırmasız null), `orderedQty` aynen
//  §6 MT dışı satır 400 · bağlı olmayan satır 400
//  §7 Koparılan bağ toplamdan düşer · sipariş miktarı/sevk aynen
//  §8 Klon (orderMode=keep) paylaştırmayı taşımaz → 0
//  §9 CANCELLED → 409 WO_PLAN_FROZEN
//  §10 Route kapısı: workorder:write ister, workorder:read 403
//
// NEGATİF SONDALAR (2026-11-19, elle bozulup koşuldu, geri alındı):
//  S1 helper'da `allocated.gt(basis)` → `false` → §2b/§2c kırmızı.
//  S2 replace'te `if (wanted === undefined) continue;` silinip `wanted ?? 0` yazıldı → §4b kırmızı.
//  S3 klonda `allocatedQty: 0` yerine 5 yazıldı → §8 kırmızı.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { WorkOrderService } from "../src/services/workorder.service";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { setOrderLinkAllocations } from "../src/services/workorder-allocation.service";
import { TamburService } from "../src/services/tambur.service";
import { cloneWorkOrderTx } from "../src/services/helpers/workorder-clone.helper";
import { workOrderPlanningRouter } from "../src/routes/workorder-planning.routes";
import { testActorId } from "./fixture-test-user";
import { findRouteLayer } from "./lib/router-katmani";

const svc = new WorkOrderService();
const link = workOrderLinkService;
const tambur = new TamburService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

async function hata(fn: () => Promise<unknown>): Promise<{ code?: string; status?: number; message?: string } | null> {
  try { await fn(); return null; } catch (e) {
    if (!(e instanceof AppError)) return { message: (e as Error).message };
    return { code: (e.details as { code?: string } | undefined)?.code, status: e.statusCode, message: e.message };
  }
}

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-WOAL-${STAMP}`;
const fx = {
  woIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[], orderIds: [] as string[],
  rollIds: [] as string[], customerIds: [] as string[],
};
let ITEM = "";
let ST_A = "";
let ST_TAMBUR = "";
let CUSTOMER = "";

type Alloc = { basis: number | null; basisKind: string; allocated: number; remaining: number | null };

let seq = 0;
async function mkWo(targetQuantity: number | null): Promise<string> {
  seq++;
  const number = `${P}-WO${seq}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: "PLANNED", targetItemId: ITEM, width: 180,
      targetQuantity,
      steps: { create: [{ stationId: ST_A, stepSequence: 1 }, { stationId: ST_TAMBUR, stepSequence: 2 }] },
    },
    select: { id: true },
  });
  fx.woIds.push(wo.id);
  await prisma.travelerCard.create({ data: { workOrderId: wo.id, cardNumber: number, barcode: number.toUpperCase() } });
  return wo.id;
}

async function mkOrder(lines: { quantity: number; unit?: "MT" | "KG" }[]): Promise<string[]> {
  const o = await prisma.order.create({
    data: {
      orderNumber: `${P}-S${fx.orderIds.length + 1}`,
      customerId: CUSTOMER,
      lines: { create: lines.map((l) => ({ itemId: ITEM, quantity: l.quantity, unit: l.unit ?? "MT" })) },
    },
    select: { id: true, lines: { select: { id: true }, orderBy: { quantity: "desc" } } },
  });
  fx.orderIds.push(o.id);
  return o.lines.map((l) => l.id);
}

const allocOf = async (woId: string): Promise<Alloc> =>
  ((await svc.findById(woId)).data as { allocation: Alloc }).allocation;
async function qtyOf(woId: string, lineId: string): Promise<number | null> {
  const r = await prisma.workOrderToOrderLine.findFirst({
    where: { workOrderId: woId, orderLineId: lineId, unlinkedAt: null }, select: { allocatedQty: true },
  });
  return r ? Number(r.allocatedQty) : null;
}

function gate(permissions: string[]): { ok: boolean; err: unknown } | null {
  const layer = findRouteLayer(workOrderPlanningRouter, "/order-links/allocations", "put");
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = { user: { userId: "x", permissions }, params: {}, body: {} } as unknown as Request;
  for (const l of chain.slice(1, -1)) {
    let called = false;
    let err: unknown;
    l.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called || err) return { ok: false, err };
  }
  return { ok: true, err: null };
}

async function main(): Promise<void> {
  console.log("=== İş emri metresini sipariş bağlarına paylaştırma ===");
  const actor = await testActorId();
  ITEM = (await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST WOAL kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(ITEM);
  const mkSt = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR") => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST WOAL ${suffix} ${STAMP}`, type: "INTERNAL", kind }, select: { id: true } });
    fx.stationIds.push(s.id);
    return s.id;
  };
  ST_A = await mkSt("QC", "PROCESS_QC");
  ST_TAMBUR = await mkSt("TMB", "TAMBUR");
  CUSTOMER = (await prisma.customer.create({ data: { code: `${P}-CUS`, name: `TEST WOAL müşteri ${STAMP}` }, select: { id: true } })).id;
  fx.customerIds.push(CUSTOMER);

  const wo = await mkWo(1200);
  const [L1, L2] = await mkOrder([{ quantity: 900 }, { quantity: 150 }]);
  await link.linkOrderLines(wo, [L1!, L2!], actor);
  const linesBefore = JSON.stringify(await prisma.orderLine.findMany({ where: { id: { in: [L1!, L2!] } }, select: { id: true, quantity: true, shippedQty: true }, orderBy: { id: "asc" } }));

  section("§1 Tavan");
  let a = await allocOf(wo);
  check("§1a top yok → TARGET 1200, paylaştırılan 0", a.basisKind === "TARGET" && a.basis === 1200 && a.allocated === 0 && a.remaining === 1200, JSON.stringify(a));
  const step1 = (await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: wo, stepSequence: 1 }, select: { id: true } })).id;
  const roll = await prisma.roll.create({
    data: { barcode: `${P}-R1`, itemId: ITEM, initialQty: 1000, currentQty: 1000, status: "IN_PRODUCTION", currentStepId: step1 },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  a = await allocOf(wo);
  check("§1b top girince → INPUT 1000", a.basisKind === "INPUT" && a.basis === 1000, JSON.stringify(a));

  section("§2 Toplam tavanı");
  const ok = await setOrderLinkAllocations(wo, [{ orderLineId: L1!, allocatedQty: 800 }, { orderLineId: L2!, allocatedQty: 200 }], actor);
  check("§2a 800+200 kabul, kalan 0", ok.data!.allocation.allocated === 1000 && ok.data!.allocation.remaining === 0 && ok.data!.changed === 2, JSON.stringify(ok.data));
  check("§2a' açığı (150 m) aşan satır UYARI alır", ok.data!.warnings.some((w) => w.includes("açığı")), ok.data!.warnings.join(" | "));
  const h = await hata(() => setOrderLinkAllocations(wo, [{ orderLineId: L1!, allocatedQty: 800 }, { orderLineId: L2!, allocatedQty: 300 }], actor));
  check("§2b 800+300 → 400 ALLOCATION_OVER_BASIS", h?.code === "ALLOCATION_OVER_BASIS" && h.status === 400, JSON.stringify(h));
  check("§2c red sonrası değerler geri alındı (800/200)", (await qtyOf(wo, L1!)) === 800 && (await qtyOf(wo, L2!)) === 200);
  check("§2d red mesajı Türkçe, fazlayı söyler", !!h?.message?.includes("fazla"), h?.message ?? "");

  section("§3 Kısmi gönderim + defter");
  await setOrderLinkAllocations(wo, [{ orderLineId: L2!, allocatedQty: 100 }], actor);
  check("§3a yalnız L2 → L1 800 korunur, L2 100", (await qtyOf(wo, L1!)) === 800 && (await qtyOf(wo, L2!)) === 100);
  const ev = await prisma.workOrderEvent.findMany({ where: { workOrderId: wo, field: "orderAllocation" }, select: { trigger: true, type: true } });
  check("§3b defterde 3 FIELD_CHANGED orderAllocation (2+1), tetik ORDER_ALLOCATION", ev.length === 3 && ev.every((e) => e.trigger === "ORDER_ALLOCATION" && e.type === "FIELD_CHANGED"), JSON.stringify(ev));
  const noop = await setOrderLinkAllocations(wo, [{ orderLineId: L2!, allocatedQty: 100 }], actor);
  check("§3c aynı değer → değişiklik yok, defter satırı yok", noop.data!.changed === 0 && (await prisma.workOrderEvent.count({ where: { workOrderId: wo, field: "orderAllocation" } })) === 3);
  const audit = await prisma.systemLog.count({ where: { recordId: wo, newData: { path: ["event"], equals: "ORDER_ALLOCATION_SET" } } });
  check("§3d audit ayak izi: 2 ORDER_ALLOCATION_SET (değişmeyen çağrı yazmaz)", audit === 2, String(audit));

  section("§4 Düzenle (replace) paylaştırmayı ezmez");
  const w0 = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo }, select: { targetQuantity: true, foldType: true } });
  const curSteps = await prisma.workOrderStep.findMany({ where: { workOrderId: wo }, orderBy: { stepSequence: "asc" }, select: { id: true, stationId: true } });
  const r4 = await hata(() => svc.replace(wo, {
    type: "ORDER_PRODUCTION", targetItemId: ITEM, width: 180, targetQuantity: Number(w0.targetQuantity),
    steps: curSteps, orderLineIds: [L1!, L2!],
  } as unknown as Parameters<typeof svc.replace>[1], actor));
  check("§4a replace geçti", r4 === null, JSON.stringify(r4));
  check("§4b replace sonrası L1 800 · L2 100 korunur", (await qtyOf(wo, L1!)) === 800 && (await qtyOf(wo, L2!)) === 100, `${await qtyOf(wo, L1!)} / ${await qtyOf(wo, L2!)}`);

  section("§5 Tambur bağlamı");
  const card = await prisma.travelerCard.findUniqueOrThrow({ where: { workOrderId: wo }, select: { barcode: true, status: true } });
  if (card.status !== "ACTIVE") await prisma.travelerCard.update({ where: { workOrderId: wo }, data: { status: "ACTIVE" } });
  type Line = { lineId: string; orderedQty: number; plannedQty: number | null };
  const ctxLines = async (): Promise<Line[]> => {
    const ctx = await tambur.getTamburContext(card.barcode, { allowEmptyStep: true });
    return (ctx.data?.orders ?? []).flatMap((o) => o.lines) as Line[];
  };
  const r5 = await hata(async () => {
    const lines1 = await ctxLines();
    const c1 = lines1.find((l) => l.lineId === L1);
    check("§5a paylaştırılan satırda plannedQty 800, orderedQty 900", c1?.plannedQty === 800 && c1?.orderedQty === 900, JSON.stringify(c1));
    await setOrderLinkAllocations(wo, [{ orderLineId: L2!, allocatedQty: 0 }], actor);
    const c2 = (await ctxLines()).find((l) => l.lineId === L2);
    check("§5b paylaştırma 0 → plannedQty null, orderedQty 150", c2?.plannedQty === null && c2?.orderedQty === 150, JSON.stringify(c2));
  });
  check("§5 tambur bağlamı açıldı", r5 === null, JSON.stringify(r5));

  section("§6 Satır kuralları");
  const [L3] = await mkOrder([{ quantity: 50, unit: "KG" }]);
  const h6c = await hata(() => setOrderLinkAllocations(wo, [{ orderLineId: L3!, allocatedQty: 0 }], actor));
  check("§6a bağlı olmayan satır → 400 ORDER_LINK_NOT_ACTIVE", h6c?.code === "ORDER_LINK_NOT_ACTIVE" && h6c.status === 400, JSON.stringify(h6c));
  await link.linkOrderLines(wo, [L3!], actor);
  const h6 = await hata(() => setOrderLinkAllocations(wo, [{ orderLineId: L3!, allocatedQty: 5 }], actor));
  check("§6b KG satıra metre → 400 ALLOCATION_UNIT_NOT_MEASURED", h6?.code === "ALLOCATION_UNIT_NOT_MEASURED" && h6.status === 400, JSON.stringify(h6));
  const dup = await hata(() => setOrderLinkAllocations(wo, [{ orderLineId: L1!, allocatedQty: 1 }, { orderLineId: L1!, allocatedQty: 2 }], actor));
  check("§6c aynı satır iki kez → 400", dup?.status === 400, JSON.stringify(dup));

  section("§7 Koparılan bağ");
  await setOrderLinkAllocations(wo, [{ orderLineId: L2!, allocatedQty: 150 }], actor);
  await link.unlinkOrderLine(wo, L2!, actor);
  a = await allocOf(wo);
  check("§7a L2 koparıldı → toplam 800, kalan 200", a.allocated === 800 && a.remaining === 200, JSON.stringify(a));
  const linesAfter = JSON.stringify(await prisma.orderLine.findMany({ where: { id: { in: [L1!, L2!] } }, select: { id: true, quantity: true, shippedQty: true }, orderBy: { id: "asc" } }));
  check("§7b sipariş miktarı + shippedQty aynen (paylaştırma karşılama değildir)", linesBefore === linesAfter);

  section("§8 Klon");
  const clone = await prisma.$transaction((tx) => cloneWorkOrderTx(tx, { sourceWorkOrderId: wo, reEntryStepSequence: 1, targetColorId: null, orderMode: "keep", movedTotalQty: 0, userId: actor } as Parameters<typeof cloneWorkOrderTx>[1]));
  fx.woIds.push(clone.newWo.id);
  const cl = await prisma.workOrderToOrderLine.findMany({ where: { workOrderId: clone.newWo.id }, select: { allocatedQty: true } });
  check("§8 klonda bağlar var, paylaştırma 0", cl.length >= 1 && cl.every((x) => Number(x.allocatedQty) === 0), JSON.stringify(cl));

  section("§9 İptal edilmiş iş emri");
  const wo2 = await mkWo(500);
  const [L5] = await mkOrder([{ quantity: 300 }]);
  await link.linkOrderLines(wo2, [L5!], actor);
  await prisma.workOrder.update({ where: { id: wo2 }, data: { status: "CANCELLED" } });
  const h9 = await hata(() => setOrderLinkAllocations(wo2, [{ orderLineId: L5!, allocatedQty: 100 }], actor));
  check("§9 CANCELLED → 409 WO_PLAN_FROZEN", h9?.status === 409 && h9.code === "WO_PLAN_FROZEN", JSON.stringify(h9));

  section("§10 Route kapısı");
  check("zincir bulundu", gate(["workorder:write"]) !== null);
  check("workorder:write geçer", gate(["workorder:write"])?.ok === true);
  const denied = gate(["workorder:read"]);
  check("yalnız workorder:read → 403", denied?.ok === false && denied.err instanceof AppError && denied.err.statusCode === 403);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  // Hareket defteri silinmeye kapalı (tamper trigger'ı) — öteki bekçiler gibi sessiz geçilir.
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: fx.woIds } } }).catch(() => undefined);
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: fx.rollIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("bağ", () => prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("orderLine", () => prisma.orderLine.deleteMany({ where: { orderId: { in: fx.orderIds } } }));
  await del("order", () => prisma.order.deleteMany({ where: { id: { in: fx.orderIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  const left = await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } });
  check("temizlik: TEST-WOAL iş emri kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
