// =============================================================================
// Test: İş emri listesi "Müşteri" — siparişsiz İE'de TOP SAHİBİ (2026-11-06, Gülkesim)
// Çalıştır: npx tsx scripts/test_workorder_customer_owner.ts
// Kaynak: `helpers/work-order-customers.helper.ts` (`resolveWorkOrderCustomers` · `loadRollOwnersByWorkOrder` ·
//   `workOrderCustomerWhere` · `workOrderOwnerNameSearchWhere`), liste `WorkOrderService.findAll`.
// Kural: açık sipariş bağı varsa müşteri SİPARİŞTEN (bugünkü davranış, top sahibi okunmaz); yoksa iş emri
//   TOPLARININ sahibi (`Roll.ownerCustomerId`; gelen belge onayı belgenin sahibini buraya yazar). Satır · süzgeç ·
//   arama aynı kuralı söyler (liste + süzgeç + sayım tek where).
//   §1 siparişli İE: topları başka sahipli olsa da müşteri = sipariş müşterisi
//   §2 siparişsiz + parti dalında iki sahip → ikisi, ilk doğan topun sahibi önce; customerCount 2
//   §3 siparişsiz + yalnız adım dalları (durduğu adım · üretildiği adım) → sahip görünür
//   §4 hiçbiri (top yok / sahipsiz top) → [] · 0 (istemci "—")
//   §5 ⭐ SQL ikizi: her fikstür İE'de `loadRollOwnersByWorkOrder` kümesi = `whereRollsOfWorkOrder` Prisma kümesi
//   §6 ⭐ filter[customerId]: sahip → siparişsiz İE'ler var, siparişli İE YOK (satırda görünmeyen müşteri süzmez);
//      sipariş müşterisi → siparişli var; CSV; total = satır sayısı; §6g kimlik listesi = tavan üstü EXISTS biçimi
//   §7 ⭐ arama: sahip adı → siparişsiz İE bulunur, siparişli İE (adı görünmeyen) bulunmaz
//   §8 koparılmış bağ (unlinkedAt) açık bağ sayılmaz → sahip görünür ve süzgeç eşler
//   §9 patron bulutu seçimi (`WO_LIST_CUSTOMER_LINKS` + `withProductionMeters`) aynı cevabı verir; seçimsiz çağrı boş
// NEGATİF SONDA (2026-11-06, tek tek, geri alındı):
//   • `resolveWorkOrderCustomers` sipariş dalını atlayıp hep sahibi döndü → §1b ❌ (servis sahibi yalnız bağsız İE için
//     okuduğundan §1 yeşil kalır — iki kat koruma; helper'ı §1b ölçer)
//   • `workOrderCustomerWhere` sahip dalından `NO_ACTIVE_ORDER_LINK` düşürüldü → §6b ❌
//   • SQL ikizinden `producedInStepId` dalı silindi → §3b + §5 ❌
//   • süzgeç kimlik sorgusundan NOT EXISTS (açık bağ) düşürüldü + Prisma `NO_ACTIVE_ORDER_LINK` düşürüldü → §6b ❌
// =============================================================================
import { randomUUID } from "crypto";
import { RollForm, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService, WO_LIST_CUSTOMER_LINKS } from "../src/services/workorder.service";
import { loadRollOwnersByWorkOrder, resolveWorkOrderCustomers, workOrderCustomerWhere } from "../src/services/helpers/work-order-customers.helper";
import { whereRollsOfWorkOrder } from "../src/services/helpers/workorder-rolls.helper";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-WOCO-${STAMP}`;
const fx = { woIds: [] as string[], rollIds: [] as string[], customerIds: [] as string[], orderIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[] };
const svc = new WorkOrderService();

type Row = { id: string; workOrderNumber: string; customers: { id: string; name: string }[]; customerCount: number };
async function list(query: Record<string, string>): Promise<{ data: Row[]; total: number }> {
  const res = (await svc.findAll({ query: { pageSize: "200", ...query } } as never)) as unknown as { data: Row[]; pagination: { total: number } };
  return { data: res.data, total: res.pagination.total };
}

async function main(): Promise<void> {
  console.log("=== İş emri müşterisi — siparişsiz İE'de top sahibi ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }

  const mkCustomer = async (tag: string, name: string) => {
    const c = await prisma.customer.create({ data: { code: `${P}-${tag}`.slice(0, 32), name: `${name} ${STAMP}` }, select: { id: true, name: true } });
    fx.customerIds.push(c.id);
    return c;
  };
  // Adlar: sahip "WOCO SAHIP" (aramada tekil), sipariş müşterisi "WOCO SIPARIS".
  const owner = await mkCustomer("OWN", "TEST WOCO SAHIP");
  const owner2 = await mkCustomer("OWN2", "TEST WOCO IKINCI");
  const orderCust = await mkCustomer("ORD", "TEST WOCO SIPARIS");
  const itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST WOCO kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(itemId);
  const stationId = (await prisma.station.create({ data: { code: `${P}-ST`.slice(0, 32), name: `TEST WOCO ist ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", department: "KALITE" }, select: { id: true } })).id;
  fx.stationIds.push(stationId);

  const mkWo = async (tag: string) => {
    const w = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-${tag}` }, select: { id: true, workOrderNumber: true } });
    fx.woIds.push(w.id);
    return w;
  };
  let seq = 0;
  const mkRoll = async (data: { ownerCustomerId: string | null; batchId?: string; currentStepId?: string; producedInStepId?: string; createdAt?: Date }) => {
    const r = await prisma.roll.create({
      data: { barcode: `${P}-R${seq++}`.slice(0, 40), itemId, initialQty: 10, currentQty: 10, status: data.currentStepId ? RollStatus.IN_PRODUCTION : RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK, ...data },
      select: { id: true },
    });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const mkBatch = async (workOrderId: string, n: string) => (await prisma.batch.create({ data: { workOrderId, batchNumber: `${P}-${n}`.slice(0, 64) }, select: { id: true } })).id;
  const mkStep = async (workOrderId: string) => (await prisma.workOrderStep.create({ data: { workOrderId, stationId, stepSequence: 1 }, select: { id: true } })).id;
  const mkOrderLine = async (customerId: string, tag: string) => {
    const o = await prisma.order.create({ data: { orderNumber: `${P}-${tag}`, customerId, lines: { create: [{ itemId, quantity: 10 }] } }, select: { id: true, lines: { select: { id: true } } } });
    fx.orderIds.push(o.id);
    return o.lines[0]!.id;
  };

  // §1 siparişli: topu "owner"a ait ama müşteri sipariş müşterisi
  const woOrder = await mkWo("SIP");
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: woOrder.id, orderLineId: await mkOrderLine(orderCust.id, "O1") } });
  await mkRoll({ ownerCustomerId: owner.id, batchId: await mkBatch(woOrder.id, "B-SIP") });
  // §2 siparişsiz, parti dalında iki sahip: owner2'nin topu ÖNCE doğdu → birincil owner2
  const woTwo = await mkWo("IKI");
  const bTwo = await mkBatch(woTwo.id, "B-IKI");
  await mkRoll({ ownerCustomerId: owner.id, batchId: bTwo, createdAt: new Date(Date.now() + 60_000) });
  await mkRoll({ ownerCustomerId: owner2.id, batchId: bTwo, createdAt: new Date(Date.now() - 60_000) });
  await mkRoll({ ownerCustomerId: owner.id, batchId: bTwo });
  // §3 yalnız adım dalları
  const woCur = await mkWo("CUR");
  await mkRoll({ ownerCustomerId: owner.id, currentStepId: await mkStep(woCur.id) });
  const woProd = await mkWo("PRD");
  await mkRoll({ ownerCustomerId: owner.id, producedInStepId: await mkStep(woProd.id) });
  // §4 hiçbiri
  const woNone = await mkWo("YOK");
  const woOwnerless = await mkWo("SAHIPSIZ");
  await mkRoll({ ownerCustomerId: null, batchId: await mkBatch(woOwnerless.id, "B-SZ") });
  // §8 koparılmış bağ + sahipli top
  const woUnlinked = await mkWo("KOP");
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: woUnlinked.id, orderLineId: await mkOrderLine(orderCust.id, "O2"), unlinkedAt: new Date(), unlinkReason: "MANUAL_UNLINK" } });
  await mkRoll({ ownerCustomerId: owner.id, batchId: await mkBatch(woUnlinked.id, "B-KOP") });

  const rows = new Map((await list({ search: P })).data.map((r) => [r.id, r]));
  const ids = (id: string) => (rows.get(id)?.customers ?? []).map((c) => c.id);

  check("§1 ⭐ siparişli İE: müşteri = sipariş müşterisi (top sahibi okunmaz)", JSON.stringify(ids(woOrder.id)) === JSON.stringify([orderCust.id]) && rows.get(woOrder.id)?.customerCount === 1, JSON.stringify(rows.get(woOrder.id)?.customers));
  const pure = resolveWorkOrderCustomers([{ orderLine: { order: { customer: { id: "o", name: "Sipariş" } } } }], [{ id: "s", name: "Sahip" }]);
  check("§1b saf: açık bağ + sahip birlikte verilse de sipariş müşterisi (helper kendi başına korur)", pure.customers.length === 1 && pure.customers[0]?.id === "o" && pure.customerCount === 1);
  const pureOwner = resolveWorkOrderCustomers([], [{ id: "s", name: "Sahip" }]);
  check("§1c saf: bağ yok → sahip", pureOwner.customers[0]?.id === "s" && pureOwner.customerCount === 1);
  check("§2 ⭐ siparişsiz + parti dalı: DISTINCT iki sahip, ilk doğan topun sahibi önce; customerCount 2",
    JSON.stringify(ids(woTwo.id)) === JSON.stringify([owner2.id, owner.id]) && rows.get(woTwo.id)?.customerCount === 2, JSON.stringify(rows.get(woTwo.id)?.customers));
  check("§2b satır yalnız id+ad taşır", (rows.get(woTwo.id)?.customers ?? []).every((c) => Object.keys(c).sort().join(",") === "id,name"));
  check("§3a siparişsiz + durduğu adım dalı → sahip", JSON.stringify(ids(woCur.id)) === JSON.stringify([owner.id]));
  check("§3b siparişsiz + üretildiği adım dalı → sahip", JSON.stringify(ids(woProd.id)) === JSON.stringify([owner.id]));
  check("§4a topsuz İE → [] · 0", rows.has(woNone.id) && ids(woNone.id).length === 0 && rows.get(woNone.id)?.customerCount === 0);
  check("§4b sahipsiz toplu İE → [] · 0", rows.has(woOwnerless.id) && ids(woOwnerless.id).length === 0 && rows.get(woOwnerless.id)?.customerCount === 0);
  check("§8a koparılmış bağ açık sayılmaz → sahip görünür", JSON.stringify(ids(woUnlinked.id)) === JSON.stringify([owner.id]));

  // §5 SQL ikizi ↔ Prisma tek tanım
  const sqlOwners = await loadRollOwnersByWorkOrder(fx.woIds);
  let twinOk = true;
  const twinDiff: string[] = [];
  for (const id of fx.woIds) {
    const viaPrisma = new Set((await prisma.roll.findMany({ where: { AND: [whereRollsOfWorkOrder(id), { ownerCustomerId: { not: null } }] }, select: { ownerCustomerId: true } })).map((r) => r.ownerCustomerId!));
    const viaSql = new Set((sqlOwners.get(id) ?? []).map((c) => c.id));
    if (viaPrisma.size !== viaSql.size || [...viaPrisma].some((x) => !viaSql.has(x))) { twinOk = false; twinDiff.push(id); }
  }
  check("§5 ⭐ SQL sahip okuması = `whereRollsOfWorkOrder` kümesi (üç dal, her fikstür İE)", twinOk, twinDiff.join(","));

  // §6 süzgeç
  const fOwner = await list({ search: P, "filter[customerId]": owner.id });
  const fOwnerIds = new Set(fOwner.data.map((r) => r.id));
  check("§6a ⭐ filter[customerId]=sahip → siparişsiz İE'ler (parti · adım · üretim · koparılmış bağ) var",
    [woTwo.id, woCur.id, woProd.id, woUnlinked.id].every((id) => fOwnerIds.has(id)), `${fOwnerIds.size}`);
  check("§6b ⭐ filter[customerId]=sahip → siparişli İE YOK (satırda sipariş müşterisi görünüyor)", !fOwnerIds.has(woOrder.id));
  check("§6c süzgeç sonucu her satırda seçilen müşteri görünür (satır ↔ süzgeç ikiz)", fOwner.data.every((r) => r.customers.some((c) => c.id === owner.id)));
  check("§6d total = satır sayısı (liste + sayım tek where)", fOwner.total === fOwner.data.length && fOwner.total === 4, `${fOwner.total}/${fOwner.data.length}`);
  const fOrder = new Set((await list({ search: P, "filter[customerId]": orderCust.id })).data.map((r) => r.id));
  check("§6e filter[customerId]=sipariş müşterisi → yalnız siparişli İE (koparılmış bağlı İE yok)", fOrder.has(woOrder.id) && !fOrder.has(woUnlinked.id) && fOrder.size === 1, `${fOrder.size}`);
  const fCsv = new Set((await list({ search: P, "filter[customerId]": `${owner2.id},${orderCust.id}` })).data.map((r) => r.id));
  check("§6f CSV owner2,sipariş → iki dal birden", fCsv.has(woTwo.id) && fCsv.has(woOrder.id) && fCsv.size === 2, `${fCsv.size}`);

  const viaCap = async (cap?: number) => new Set((await prisma.workOrder.findMany({ where: { AND: [{ id: { in: fx.woIds } }, await workOrderCustomerWhere({ in: [owner.id, owner2.id] }, cap)] }, select: { id: true } })).map((w) => w.id));
  const listForm = await viaCap();
  const existsForm = await viaCap(1);
  check("§6g ⭐ kimlik listesi biçimi = tavan aşımındaki EXISTS biçimi (aynı küme, sessiz kesme yok)",
    listForm.size === 4 && existsForm.size === listForm.size && [...listForm].every((x) => existsForm.has(x)), `${listForm.size}/${existsForm.size}`);

  // §7 arama
  const sOwner = new Set((await list({ search: `TEST WOCO SAHIP ${STAMP}` })).data.map((r) => r.id));
  check("§7a ⭐ sahip adıyla arama → siparişsiz İE bulunur", sOwner.has(woTwo.id) && sOwner.has(woCur.id) && sOwner.has(woProd.id));
  check("§7b sahip adıyla arama → siparişli İE bulunmaz (adı satırda yok)", !sOwner.has(woOrder.id));
  const sOrder = new Set((await list({ search: `TEST WOCO SIPARIS ${STAMP}` })).data.map((r) => r.id));
  check("§7c sipariş müşterisi adıyla arama regresyonsuz", sOrder.has(woOrder.id) && !sOrder.has(woTwo.id));

  // §9 bulut seçimi
  const cloudRows = await prisma.workOrder.findMany({ where: { id: { in: [woOrder.id, woTwo.id, woNone.id] } }, select: { id: true, steps: { select: { id: true, stepSequence: true } }, orderLinks: WO_LIST_CUSTOMER_LINKS } });
  const cloud = new Map((await svc.withProductionMeters(cloudRows)).map((w) => [w.id, w.customers.map((c) => c.id)]));
  check("§9a bulut seçimi listeyle aynı (siparişli · iki sahip · boş)",
    JSON.stringify(cloud.get(woOrder.id)) === JSON.stringify([orderCust.id]) && JSON.stringify(cloud.get(woTwo.id)) === JSON.stringify([owner2.id, owner.id]) && cloud.get(woNone.id)?.length === 0);
  const bare = await svc.withProductionMeters([{ id: woTwo.id, steps: [] }]);
  check("§9b `orderLinks` seçilmeden çağrı → sahip okunmaz (bugünkü gibi boş)", bare[0]?.customers.length === 0);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("bağ", () => prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("parti", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("adım", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("iş emri", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("sipariş", () => prisma.order.deleteMany({ where: { id: { in: fx.orderIds } } }));
  await del("istasyon", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("kalem", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("müşteri", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  check("temizlik: TEST-WOCO kalıntısı yok", (await prisma.workOrder.count({ where: { id: { in: fx.woIds } } })) === 0 && (await prisma.roll.count({ where: { id: { in: fx.rollIds } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e); })
  .finally(async () => {
    stopNotificationJobs();
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
