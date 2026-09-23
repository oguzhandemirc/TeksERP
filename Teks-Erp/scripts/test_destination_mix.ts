// =============================================================================
// YURTİÇİ / YURTDIŞI SATIŞ RAPORU (R2, 2026-09-23) — `getDestinationMix`, gerçek DB
// =============================================================================
// §1 kovalar: yurtiçi · yurtdışı · "yön kaydı yok" (fasondan doğrudan sevk — DB'de GERÇEK
//    DirectShipment, fasoncu `fixture-subcontractor`dan) ayrı; sevkiyatın DONMUŞ yönü, cari kartı değil.
// §2 kg: tartısız çuval 0 sayılmaz (tartılı N / M) · iade AYRI sütun, brüt metreden düşülmez.
// §3 tutar: para birimleri ayrı; fiyatsız satır 0 değil (fiyatlı N / M); TL yalnız sevk günü kuruyla,
//    kur yoksa "kur yok" sayılır; ortalama birim fiyat = tutar / fiyatlı miktar.
// §4 ülke: serbest metin trim + katlanmış gruplama (" almanya " = "ALMANYA"), boş → "Belirtilmemiş".
// §5 açık sipariş (bugün) + termin (dönem) siparişin şube → cari zincirinden; zincir boş → "UNSET".
// §6 karşılaştırma dönemi ayrı kovalar.
// NEGATİF SONDALAR (2026-09-23, geri alındı → 17/0): ① doğrudan sevk yurtiçine katıldı → §1b/§1c ❌ ·
//   ② fiyatsız satır 0 fiyatlı sayıldı → §3c ❌ · ③ kur yoksa 1 sayıldı → §3b ❌ · ④ ülke katlanmadan gruplandı
//   → §4a ❌ · ⑤ zincir boş sipariş yurtiçine düştü → §5b ❌ · ⑥ iade sütunu 0 → §2c ❌ ·
//   ⑦ `sa."clearedAt" IS NULL` silindi → §3e ❌ (+§3a) · ⑧ ham SQL'e `ol."cancelledAt" IS NULL` eklendi → §3f ❌
// §3e damgalı (sevkiyat düzenlemesinde bırakılmış) tahsis tutara GİRMEZ · §3f sonradan İPTAL edilen
//    kalemin sevk edilmiş tutarı GİRER (GEÇMİŞ sorusu — `order-line-scope.helper` "geçmiş süzmez").
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Pencere 2098-05 (karşılaştırma 2098-04).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import type { Currency, ShipmentDestination } from "@prisma/client";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { resolveShipmentDestination } from "../src/services/helpers/shipment-destination.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";
import { getDestinationMix, type DestinationMixReport } from "../src/services/reports/destination-mix.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-DMX-${process.pid}`;
const RANGE = { from: new Date("2098-05-01T00:00:00.000Z"), to: new Date("2098-05-31T23:59:59.999Z") };
const PREV = { from: new Date("2098-04-01T00:00:00.000Z"), to: new Date("2098-04-30T23:59:59.999Z") };
const D1 = new Date("2098-05-10T09:00:00.000Z"); // kur VAR (USD 30)
const D2 = new Date("2098-05-12T09:00:00.000Z"); // kur YOK

const ids = { customers: [] as string[], orders: [] as string[], shipments: [] as string[], sacks: [] as string[], rolls: [] as string[], returns: [] as string[], rates: [] as string[], direct: [] as string[], directAlloc: [] as string[] };
let wo: { id: string } | null = null;
let batch: { id: string } | null = null;
let step: { id: string } | null = null;
let station: { id: string } | null = null;
let dispatch: { id: string } | null = null;
let item: { id: string } | null = null;

async function cari(n: string, d: ShipmentDestination | null, country: string | null): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} ${n}`, defaultDestination: d, country }, select: { id: true } });
  ids.customers.push(c.id);
  return c.id;
}
async function satir(customerId: string, currency: Currency, qty: number, unitPrice: number | null, extra: { deadline?: Date; status?: "APPROVED" | "COMPLETED"; completedAt?: Date; shippedQty?: number } = {}): Promise<string> {
  // Sipariş yazar gibi doğar: yön açılışta zincirden donar (2026-09-23; raporlar kolonu okur).
  const destination = (await resolveShipmentDestination(prisma, { customerId })).destination;
  const o = await prisma.order.create({
    data: {
      orderNumber: `${TAG}-O${ids.orders.length}`, customerId, destination, currency, orderDate: D1, status: extra.status ?? "APPROVED",
      deadline: extra.deadline ?? null, completedAt: extra.completedAt ?? null,
      lines: { create: [{ itemId: item!.id, quantity: qty, unitPrice, shippedQty: extra.shippedQty ?? 0 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  ids.orders.push(o.id);
  return o.lines[0]!.id;
}
/** Çuvallı sevkiyat: top + çuval (kg opsiyonel) + tahsis(ler). */
async function sevk(customerId: string, destination: ShipmentDestination, at: Date, meters: number, kg: number | null, allocs: Array<[string, number]>): Promise<string> {
  const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S${ids.shipments.length}`, customerId, status: "DISPATCHED", destination, dispatchedAt: at }, select: { id: true } });
  ids.shipments.push(sh.id);
  const k = await prisma.sack.create({ data: { sackNo: `${TAG}-K${ids.sacks.length}`, customerId, shipmentId: sh.id, weightKg: kg }, select: { id: true } });
  ids.sacks.push(k.id);
  const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${ids.rolls.length}`, itemId: item!.id, initialQty: meters, currentQty: meters, status: "SHIPPED", sackId: k.id, shipmentId: sh.id }, select: { id: true } });
  ids.rolls.push(r.id);
  for (const [orderLineId, qty] of allocs) await prisma.sackAllocation.create({ data: { sackId: k.id, orderLineId, qty } });
  return sh.id;
}

function bucket(r: DestinationMixReport, b: string) {
  return r.buckets.find((x) => x.bucket === b)!;
}

/** İptal edilmiş kalem — sevk edilmiş tutarı geçmişte durur. */
async function iptalEt(lineId: string): Promise<void> {
  const admin = await ensureTestAdmin();
  await prisma.orderLine.update({ where: { id: lineId }, data: { cancelledAt: new Date("2098-04-20T09:00:00.000Z"), cancelledById: admin.id, cancelReason: "test" } });
}

async function kur(): Promise<{ cE: string; cE2: string; cD: string; cN: string }> {
  item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  const cE = await cari("CE", "EXPORT", " almanya ");
  const cE2 = await cari("CE2", "EXPORT", "ALMANYA");
  const cD = await cari("CD", "DOMESTIC", null);
  const cN = await cari("CN", null, null);
  const rate = await prisma.exchangeRate.create({ data: { rateDate: new Date("2098-05-10"), currency: "USD", rate: 30 }, select: { id: true } });
  ids.rates.push(rate.id);
  // `shippedQty` gerçek akışta sevk yazar; fikstür tahsisi elle kurduğu için aynı değer burada verilir.
  const lE = await satir(cE, "USD", 200, 5, { shippedQty: 100 });
  const lE2 = await satir(cE2, "USD", 50, 4, { shippedQty: 40 });
  const lDp = await satir(cD, "TRY", 100, 100);
  const lDu = await satir(cD, "TRY", 100, null);
  // Yurtdışı: cE 100 m (90 sevkte + 10 iade), 10 kg tartılı, USD kurlu gün
  const sE = await sevk(cE, "EXPORT", D1, 90, 10, [[lE, 100]]);
  // §3e — aynı çuvalda DAMGALI (bırakılmış) tahsis: USD 7 × 50 tutara girmemeli
  const lX = await satir(cE, "USD", 50, 7, { shippedQty: 50 }); // açık değil — §5a backlog etkilenmez
  const admin0 = await ensureTestAdmin();
  const kE = ids.sacks[ids.sacks.length - 1]!;
  await prisma.sackAllocation.create({ data: { sackId: kE, orderLineId: lX, qty: 50, clearedAt: D1, clearedShipmentId: sE, clearedById: admin0.id } });
  const rr = await prisma.roll.create({ data: { barcode: `${TAG}-RR`, itemId: item.id, initialQty: 10, currentQty: 10, status: "WAREHOUSE" }, select: { id: true } });
  ids.rolls.push(rr.id);
  const admin = await ensureTestAdmin();
  const ret = await prisma.rollReturn.create({ data: { rollId: rr.id, customerId: cE, itemId: item.id, qty: 10, receivedById: admin.id, fromShipmentId: sE }, select: { id: true } });
  ids.returns.push(ret.id);
  // Yurtdışı: cE2 40 m, kur YOK günü
  await sevk(cE2, "EXPORT", D2, 40, 5, [[lE2, 40]]);
  // Yurtiçi: cD 50 m tartısız, 30 fiyatlı + 20 fiyatsız tahsis
  await sevk(cD, "DOMESTIC", D1, 50, null, [[lDp, 30], [lDu, 20]]);
  // Karşılaştırma dönemi: yurtiçi 25 m
  // §3f — tahsisli kalem sevkten SONRA iptal edildi: TRY 10 × 25 = 250 tutarda durur
  const lC = await satir(cD, "TRY", 25, 10, { shippedQty: 25 });
  await sevk(cD, "DOMESTIC", new Date("2098-04-15T09:00:00.000Z"), 25, null, [[lC, 25]]);
  await iptalEt(lC);
  // Doğrudan sevk (yön kaydı yok) — GERÇEK DirectShipment, fasoncu fixture-subcontractor'dan
  const sub = await ensureTestDyeHouse();
  station = await prisma.station.create({ data: { code: `${TAG}-STN`, name: `${TAG} fason`, type: "EXTERNAL" }, select: { id: true } });
  wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true } });
  batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true } });
  dispatch = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-SD`, workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: sub.id, dispatchedAt: D1 }, select: { id: true } });
  const ds = await prisma.directShipment.create({ data: { shipmentNo: `${TAG}-DS`, dispatchId: dispatch.id, customerId: cD, reason: "test", totalQty: 15, rollCount: 1, shippedAt: D1 }, select: { id: true } });
  ids.direct.push(ds.id);
  const dr = await prisma.roll.create({ data: { barcode: `${TAG}-DR`, itemId: item.id, initialQty: 15, currentQty: 15, status: "SHIPPED", directShipmentId: ds.id }, select: { id: true } });
  ids.rolls.push(dr.id);
  const da = await prisma.subcontractorDirectShipAllocation.create({ data: { dispatchId: dispatch.id, orderLineId: lDp, qty: 15, directShipmentId: ds.id }, select: { id: true } });
  ids.directAlloc.push(da.id);
  // Açık sipariş + termin: cE açık 60 m (termini geçmiş) · cN (zincir boş) açık 20 m · dönemde termini olan, geç kapanmış
  await satir(cE, "USD", 60, 6, { deadline: new Date("2020-01-01") });
  await satir(cN, "TRY", 20, null);
  await satir(cE2, "USD", 10, 4, { deadline: new Date("2098-05-05"), status: "COMPLETED", completedAt: new Date("2098-05-08"), shippedQty: 10 });
  return { cE, cE2, cD, cN };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  try {
    const { cE, cN } = await kur();
    const r = await getDestinationMix(RANGE, PREV);
    const E = bucket(r, "EXPORT");
    const D = bucket(r, "DOMESTIC");
    const N = bucket(r, "NONE");
    const mine = (x: number) => x; // pencere 2098 — başka veri yok
    console.log("── §1 kovalar ──");
    check("§1a yurtdışı metre 140 (90 + iade 10 geri eklenmiş + 40), 2 sevkiyat", mine(E.meters) === 140 && E.shipmentCount === 2, `${E.meters}/${E.shipmentCount}`);
    check("§1b yurtiçi 50 m", D.meters === 50, String(D.meters));
    check("§1c doğrudan sevk AYRI kova 'yön kaydı yok' 15 m / 1 sevk — yurtiçine girmedi", N.meters === 15 && N.shipmentCount === 1 && N.label.includes("Yön kaydı yok"), `${N.meters}/${N.shipmentCount}`);
    console.log("── §2 kg + iade ──");
    check("§2a yurtdışı 15 kg, tartılı 2 / 2", E.kg === 15 && E.weighedSacks === 2 && E.totalSacks === 2, `${E.kg} ${E.weighedSacks}/${E.totalSacks}`);
    check("§2b yurtiçi tartısız → tartılı 0 / 1 (kg 0 değil ÖLÇÜLMEDİ)", D.weighedSacks === 0 && D.totalSacks === 1);
    check("§2c iade AYRI sütun 10 m; brüt metre düşülmedi", E.returnQty === 10 && E.meters === 140);
    console.log("── §3 tutar ──");
    const usd = E.money.amounts.find((a) => a.currency === "USD");
    check("§3a yurtdışı USD 500 + 160 = 660; ort. birim fiyat 660/140 = 4.71", usd?.amount === 660 && usd?.avgUnitPrice === 4.71, JSON.stringify(usd));
    check("§3b TL yalnız kurlu gün: 500 × 30 = 15000; kur yok 1 satır", E.money.tlTotal === 15000 && E.money.noRateLineCount === 1, `${E.money.tlTotal}/${E.money.noRateLineCount}`);
    check("§3c yurtiçi fiyatlı 1 / 2 satır; TRY 3000 (fiyatsız 0 sayılmadı)", D.money.pricedLineCount === 1 && D.money.lineCount === 2 && D.money.amounts[0]?.amount === 3000, JSON.stringify(D.money));
    check("§3d doğrudan sevk tutarı kendi kovasında (TRY 1500)", N.money.amounts.find((a) => a.currency === "TRY")?.amount === 1500);
    check("§3e ⭐ damgalı (bırakılmış) tahsis tutara GİRMEDİ — yurtdışı 2 satır, USD 660", E.money.lineCount === 2 && usd?.amount === 660, `${E.money.lineCount} ${JSON.stringify(usd)}`);
    const pD = bucket({ ...r, buckets: r.prevBuckets! }, "DOMESTIC");
    check("§3f ⭐ sevkten sonra iptal edilen kalemin tutarı GEÇMİŞTE durur (TRY 250, 1 satır)", pD.money.lineCount === 1 && pD.money.amounts[0]?.amount === 250, JSON.stringify(pD.money));
    console.log("── §4 ülke ──");
    const de = r.byCountry.filter((c) => c.bucket === "EXPORT" && c.label.trim().toLowerCase() === "almanya");
    check("§4a ' almanya ' ve 'ALMANYA' tek grup, 2 müşteri, 140 m", de.length === 1 && de[0]!.customerCount === 2 && de[0]!.meters === 140, JSON.stringify(de.map((x) => [x.label, x.customerCount, x.meters])));
    check("§4b ülkesi boş → 'Belirtilmemiş'", r.byCountry.some((c) => c.bucket === "DOMESTIC" && c.label === "Belirtilmemiş"));
    check("§4c kapsam: dönemdeki müşterilerden ülkesi dolu olan sayılır", r.kapsam.customersWithCountry >= 2 && r.kapsam.customersWithCountry < r.kapsam.customersInPeriod, JSON.stringify(r.kapsam));
    console.log("── §5 açık sipariş + termin ──");
    const bx = r.backlogExport.filter((b) => b.customerId === cE);
    check("§5a yurtdışı backlog: cE açık 200−100 + 60 = 160 m, termini geçen 60", bx.reduce((a, b) => a + b.openQty, 0) === 160 && bx.reduce((a, b) => a + b.overdueQty, 0) === 60, JSON.stringify(bx.map((b) => [b.openQty, b.overdueQty])));
    check("§5b zincir boş cari → 'UNSET' kovası (yurtiçi uydurulmadı)", r.backlog.find((b) => b.bucket === "UNSET")!.openQty >= 20 && !r.backlogExport.some((b) => b.customerId === cN));
    const fx = r.fulfillment.find((f) => f.bucket === "EXPORT");
    check("§5c termin: dönemde termini olan yurtdışı sipariş geç kapandı (3 gün)", fx?.lateCompleted === 1 && fx?.avgLateDays === 3, JSON.stringify(fx));
    console.log("── §6 karşılaştırma ──");
    check("§6 önceki dönem yurtiçi 25 m, yurtdışı 0", bucket({ ...r, buckets: r.prevBuckets! }, "DOMESTIC").meters === 25 && bucket({ ...r, buckets: r.prevBuckets! }, "EXPORT").meters === 0);
  } finally {
    await temizlik();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizlik(): Promise<void> {
  await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { id: { in: ids.directAlloc } } });
  await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.directShipment.deleteMany({ where: { id: { in: ids.direct } } });
  if (dispatch) await prisma.subcontractorDispatch.deleteMany({ where: { id: dispatch.id } });
  if (batch) await prisma.batch.deleteMany({ where: { id: batch.id } });
  if (step) await prisma.workOrderStep.deleteMany({ where: { id: step.id } });
  if (wo) await prisma.workOrder.deleteMany({ where: { id: wo.id } });
  if (station) await prisma.station.deleteMany({ where: { id: station.id } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  await prisma.exchangeRate.deleteMany({ where: { id: { in: ids.rates } } });
  if (item) await prisma.item.deleteMany({ where: { id: item.id } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  try { await temizlik(); } catch { /* ikinci deneme — kalıntı sonraki koşumda görünür */ }
  await pool.end();
  process.exit(1);
});
