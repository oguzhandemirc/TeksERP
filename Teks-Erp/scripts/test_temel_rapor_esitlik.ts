// =============================================================================
// TEMEL RAPOR SAYI EŞİTLİĞİ (Raporlar v2) — temel rapor sayısı = mevcut raporun alanı, gerçek DB
// =============================================================================
// Kural (`docs/kurallar/raporlar.md`): temel rapor sayısı mevcut rapor servisinden okunur; temel
// serviste yeni SQL yazılmaz. Bu bekçi her ana/yan sayıyı AYNI parametreyle çağrılan kaynak
// alanla kıyaslar (en az bir süzgeçli vaka). Bölümler dilim başına: § Satış (RAPA) — RAPB/RAPC
// kendi bölümünü ekler.
// § Satış (RAPA): S1 sipariş-talep · S2 sevkiyat · S3 termin · S4 açık siparişler · S5 vazgeçilen iş
//   · S6 K-KIYAS (parametresiz çağrı = önceki dönem kıyası) · S7 iki iptal tanımı (ölçülür, basılır).
// NEGATİF SONDALAR (2026-10-24, md5 ile geri alındı → 34/0): ① `termin.temel.ts` ana sayısı terminsizleri
//   paydaya kattı → S3a ❌ (33.3 ≠ 50) · ② `sevkiyat.temel.ts` ana sayısı `_shipped` yerine Sevk & Termin
//   `daily` NET serisinden okundu → S2a ❌ (340 ≠ 350) + S2e ❌ · ③ `vazgecilen-is` ana sayısından iade
//   düşürüldü → S5a ❌ (70 ≠ 80). ⚠️ KÖR: `acik-siparisler` ana sayısının `coveragePct`e bağlanması bu
//   fikstürde YAKALANMAZ (üretimde pay 0 → iki oran eşit); EK alanın formülünü S4c ölçer.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Pencere 2097-03 (kıyas 2097-02); boş pencere 2096-06.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import type { Currency, ShipmentDestination } from "@prisma/client";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { resolveShipmentDestination } from "../src/services/helpers/shipment-destination.helper";
import { ensureTestAdmin } from "./fixture-test-user";
import { resolveCompareRange } from "../src/services/reports/_shared";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";
import { getShipmentScorecard } from "../src/services/reports/shipment-scorecard.report.service";
import { getDestinationMix } from "../src/services/reports/destination-mix.report.service";
import { getOrderLeadTime, MIN_SAMPLE } from "../src/services/reports/order-leadtime.report.service";
import { getOpenOrderCoverage } from "../src/services/reports/open-order-coverage.report.service";
import { getReturnScorecard } from "../src/services/reports/return-scorecard.report.service";
import { getOrderCancellationScorecard } from "../src/services/reports/order-cancellation.report.service";
import { resolveCoreCompare } from "../src/services/reports/temel/_common";
import { buildOrderDemandReport } from "../src/services/reports/temel/siparis-talep.temel";
import { buildShippedReport } from "../src/services/reports/temel/sevkiyat.temel";
import { buildDeadlineReport } from "../src/services/reports/temel/termin.temel";
import { buildOpenOrderReport } from "../src/services/reports/temel/acik-siparisler.temel";
import { buildLostWorkReport } from "../src/services/reports/temel/vazgecilen-is.temel";
import type { AnaSayi, RaporSunumu } from "../src/services/reports/sunum/sunum.types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-TRE-${process.pid}`;
const RANGE = { from: new Date("2097-03-01T00:00:00.000Z"), to: new Date("2097-03-31T23:59:59.999Z") };
const PREV = { from: new Date("2097-02-01T00:00:00.000Z"), to: new Date("2097-02-28T23:59:59.999Z") };
const EMPTY = { from: new Date("2096-06-01T00:00:00.000Z"), to: new Date("2096-06-30T23:59:59.999Z") };
const at = (s: string) => new Date(`${s}T09:00:00.000Z`);

const ids = { customers: [] as string[], orders: [] as string[], shipments: [] as string[], sacks: [] as string[], rolls: [] as string[], returns: [] as string[] };
let itemId = "";

async function customer(n: string, d: ShipmentDestination): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} ${n}`, defaultDestination: d }, select: { id: true } });
  ids.customers.push(c.id);
  return c.id;
}
interface OrderOpts { orderDate: string; currency?: Currency; unitPrice?: number | null; deadline?: string; status?: "APPROVED" | "COMPLETED" | "CANCELLED"; completedAt?: string; cancelledAt?: string; shippedQty?: number }
async function order(customerId: string, qty: number, o: OrderOpts): Promise<string> {
  const destination = (await resolveShipmentDestination(prisma, { customerId })).destination;
  const r = await prisma.order.create({
    data: {
      orderNumber: `${TAG}-O${ids.orders.length}`, customerId, destination, currency: o.currency ?? "TRY", orderDate: at(o.orderDate),
      status: o.status ?? "APPROVED", deadline: o.deadline ? at(o.deadline) : null, completedAt: o.completedAt ? at(o.completedAt) : null,
      cancelledAt: o.cancelledAt ? at(o.cancelledAt) : null,
      lines: { create: [{ itemId, quantity: qty, unitPrice: o.unitPrice ?? null, shippedQty: o.shippedQty ?? 0 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  ids.orders.push(r.id);
  return r.lines[0]!.id;
}
async function ship(customerId: string, destination: ShipmentDestination, day: string, meters: number, lineId: string, allocQty: number): Promise<string> {
  const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S${ids.shipments.length}`, customerId, status: "DISPATCHED", destination, dispatchedAt: at(day) }, select: { id: true } });
  ids.shipments.push(sh.id);
  const k = await prisma.sack.create({ data: { sackNo: `${TAG}-K${ids.sacks.length}`, customerId, shipmentId: sh.id }, select: { id: true } });
  ids.sacks.push(k.id);
  const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${ids.rolls.length}`, itemId, initialQty: meters, currentQty: meters, status: "SHIPPED", sackId: k.id, shipmentId: sh.id }, select: { id: true } });
  ids.rolls.push(r.id);
  await prisma.sackAllocation.create({ data: { sackId: k.id, orderLineId: lineId, qty: allocQty } });
  return sh.id;
}

async function setup(): Promise<{ cD: string; cE: string }> {
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  itemId = item.id;
  const cD = await customer("CD", "DOMESTIC");
  const cE = await customer("CE", "EXPORT");
  // Mart: zamanında (yurtiçi) · geç (yurtdışı) · terminsiz · dönemde alınıp iptal · açık (termini geçmiş)
  const lD1 = await order(cD, 100, { orderDate: "2097-03-02", unitPrice: 10, deadline: "2097-03-10", status: "COMPLETED", completedAt: "2097-03-08", shippedQty: 100 });
  const lE1 = await order(cE, 200, { orderDate: "2097-03-02", currency: "USD", unitPrice: 5, deadline: "2097-03-05", status: "COMPLETED", completedAt: "2097-03-09", shippedQty: 200 });
  const lD2 = await order(cD, 50, { orderDate: "2097-03-03", status: "COMPLETED", completedAt: "2097-03-12", shippedQty: 50 });
  await order(cD, 30, { orderDate: "2097-03-02", unitPrice: 10, status: "CANCELLED", cancelledAt: "2097-03-15" });
  await order(cD, 80, { orderDate: "2097-03-04", unitPrice: 12, deadline: "2020-01-01" });
  // Ocak'ta alınıp Mart'ta iptal: iki iptal tanımını ayıran sipariş
  await order(cE, 40, { orderDate: "2097-01-10", currency: "USD", unitPrice: 5, status: "CANCELLED", cancelledAt: "2097-03-20" });
  // Şubat (kıyas): zamanında yurtiçi 60 m
  const lP = await order(cD, 60, { orderDate: "2097-02-01", unitPrice: 10, deadline: "2097-02-15", status: "COMPLETED", completedAt: "2097-02-10", shippedQty: 60 });
  await ship(cD, "DOMESTIC", "2097-03-07", 100, lD1, 100);
  const sE = await ship(cE, "EXPORT", "2097-03-09", 190, lE1, 200); // 10 m iade edildi → canlı 190, brüt 200
  await ship(cD, "DOMESTIC", "2097-03-11", 50, lD2, 50);
  await ship(cD, "DOMESTIC", "2097-02-08", 60, lP, 60);
  const admin = await ensureTestAdmin();
  const rr = await prisma.roll.create({ data: { barcode: `${TAG}-RR`, itemId, initialQty: 10, currentQty: 10, status: "WAREHOUSE" }, select: { id: true } });
  ids.rolls.push(rr.id);
  const ret = await prisma.rollReturn.create({ data: { rollId: rr.id, customerId: cE, itemId, qty: 10, receivedById: admin.id, fromShipmentId: sE, createdAt: at("2097-03-20") }, select: { id: true } });
  ids.returns.push(ret.id);
  const wh = await prisma.roll.create({ data: { barcode: `${TAG}-RW`, itemId, initialQty: 30, currentQty: 30, status: "WAREHOUSE" }, select: { id: true } });
  ids.rolls.push(wh.id);
  return { cD, cE };
}

const side = (s: RaporSunumu, olcu: string): AnaSayi | undefined => s.yanSayilar.find((y) => y.olcu === olcu);
const near = (a: number | null | undefined, b: number | null | undefined, eps = 0.051): boolean =>
  a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= eps;
function shape(label: string, s: RaporSunumu): void {
  check(`${label} zarf biçimi (yan ≤3 · tanım dolu · anlatı dizi · başlık katalogdan)`,
    s.yanSayilar.length <= 3 && s.tanimlar.length > 0 && Array.isArray(s.anlati) && s.baslik.length > 0 && s.soru.length > 0,
    `yan ${s.yanSayilar.length} · tanım ${s.tanimlar.length} · anlatı ${s.anlati.length}`);
}

async function salesSection(cD: string): Promise<void> {
  console.log("\n══ § Satış (RAPA) ══");

  console.log("── S1 sipariş-talep (Sipariş Karnesi) ──");
  {
    const src = await getOrderIntake(RANGE, PREV, {});
    const { sunum: s } = await buildOrderDemandReport({ range: RANGE, compareRange: PREV, compareMode: "prev", filters: {} });
    shape("S1z", s);
    check("S1a ana sayı = summary.totalQty", s.anaSayi.deger === src.summary.totalQty, `${s.anaSayi.deger} / ${src.summary.totalQty}`);
    check("S1b kıyas = summary.prevTotalQty", s.anaSayi.kiyas?.deger === src.summary.prevTotalQty, `${s.anaSayi.kiyas?.deger} / ${src.summary.prevTotalQty}`);
    check("S1c yan: sipariş adedi = activeOrderCount · müşteri = customerCount",
      side(s, "siparis.aktifAdet")?.deger === src.summary.activeOrderCount && side(s, "siparis.musteriSayisi")?.deger === src.summary.customerCount,
      `${side(s, "siparis.aktifAdet")?.deger}/${src.summary.activeOrderCount} · ${side(s, "siparis.musteriSayisi")?.deger}/${src.summary.customerCount}`);
    check("S1d çok para birimi → tutar ÖLÇÜLEMEDİ (null, 0 değil)", src.summary.amounts.length > 1 && side(s, "siparis.tutar")?.deger === null,
      JSON.stringify(src.summary.amounts));
    const srcF = await getOrderIntake(RANGE, null, { customerId: [cD] });
    const { sunum: f } = await buildOrderDemandReport({ range: RANGE, compareRange: null, compareMode: "none", filters: { customerId: [cD] } });
    const amt = side(f, "siparis.tutar");
    check("S1e süzgeçli (müşteri): ana = totalQty · tutar = amounts[0] (TRY)",
      f.anaSayi.deger === srcF.summary.totalQty && srcF.summary.amounts.length === 1 && amt?.deger === srcF.summary.amounts[0]!.amount && amt?.birim === "TRY",
      `${f.anaSayi.deger}/${srcF.summary.totalQty} · ${amt?.deger} ${amt?.birim} / ${JSON.stringify(srcF.summary.amounts)}`);
    check("S1f fiyatsız satır tutara 0 diye girmez (sayısı ayrı)", srcF.summary.unpricedLineCount === 1 && srcF.summary.pricedLineCount === 2,
      `fiyatlı ${srcF.summary.pricedLineCount} · fiyatsız ${srcF.summary.unpricedLineCount}`);
  }

  console.log("── S2 sevkiyat (BRÜT `_shipped`) ──");
  {
    const sc = await getShipmentScorecard(RANGE, null, {});
    const scPrev = await getShipmentScorecard(PREV, null, {});
    const mix = await getDestinationMix(RANGE, null);
    const { sunum: s } = await buildShippedReport({ range: RANGE, compareRange: PREV, compareMode: "prev", filters: {} });
    shape("S2z", s);
    check("S2a ⭐ ana sayı = Sevk & Termin `summary.shippedQty` (brüt, iade geri eklenmiş)", s.anaSayi.deger === sc.summary.shippedQty && sc.summary.shippedQty === 350,
      `${s.anaSayi.deger} / ${sc.summary.shippedQty} (beklenen 350)`);
    check("S2b kıyas = önceki dönem shippedQty", s.anaSayi.kiyas?.deger === scPrev.summary.shippedQty, `${s.anaSayi.kiyas?.deger} / ${scPrev.summary.shippedQty}`);
    const meters = mix.buckets.reduce((a, b) => a + b.meters, 0);
    const exp = mix.buckets.find((b) => b.bucket === "EXPORT")!;
    check("S2c ihracat payı = Yurtiçi/Yurtdışı EXPORT metre / toplam", near(side(s, "sevk.ihracatPayi")?.deger, Math.round((exp.meters * 1000) / meters) / 10),
      `${side(s, "sevk.ihracatPayi")?.deger} / ${exp.meters}÷${meters}`);
    const tl = mix.buckets.reduce((a, b) => a + b.money.tlTotal, 0);
    check("S2d çok para birimi → tutar = TL karşılığı (kova tlTotal toplamı)", near(side(s, "sevk.tutar")?.deger, tl, 0.011), `${side(s, "sevk.tutar")?.deger} / ${tl}`);
    const scE = await getShipmentScorecard(RANGE, null, { destination: "EXPORT" });
    const { sunum: f } = await buildShippedReport({ range: RANGE, compareRange: null, compareMode: "none", filters: { destination: "EXPORT" } });
    const usd = exp.money.amounts.find((a) => a.currency === "USD");
    check("S2e süzgeçli (yön EXPORT): ana = shippedQty · tutar = EXPORT USD · ihracat payı gösterilmez",
      f.anaSayi.deger === scE.summary.shippedQty && side(f, "sevk.tutar")?.deger === usd?.amount && side(f, "sevk.tutar")?.birim === "USD" && !side(f, "sevk.ihracatPayi"),
      `${f.anaSayi.deger}/${scE.summary.shippedQty} · ${side(f, "sevk.tutar")?.deger}/${usd?.amount}`);
  }

  console.log("── S3 termin (zamanında teslim + teslim süresi) ──");
  {
    const sc = await getShipmentScorecard(RANGE, null, {});
    const scPrev = await getShipmentScorecard(PREV, null, {});
    const lt = await getOrderLeadTime(RANGE, {});
    const { sunum: s } = await buildDeadlineReport({ range: RANGE, compareRange: PREV, compareMode: "prev", filters: {} });
    shape("S3z", s);
    check("S3a ⭐ ana sayı = `onTimePct` (terminsiz paydada YOK)", sc.summary.withDeadlineOrders > 0 && s.anaSayi.deger === sc.summary.onTimePct && sc.summary.noDeadlineOrders > 0,
      `${s.anaSayi.deger} / ${sc.summary.onTimePct} · terminli ${sc.summary.withDeadlineOrders} · terminsiz ${sc.summary.noDeadlineOrders}`);
    check("S3b kıyas = önceki dönem onTimePct", s.anaSayi.kiyas?.deger === scPrev.summary.onTimePct, `${s.anaSayi.kiyas?.deger} / ${scPrev.summary.onTimePct}`);
    check("S3c geç kalan = withDeadline − onTime", side(s, "termin.gecikenSiparis")?.deger === sc.summary.withDeadlineOrders - sc.summary.onTimeOrders);
    const med = side(s, "termin.yariSureGun");
    check("S3d teslim süresi = fullClose.medianDays (az örnekte ölçülemedi)",
      lt.fullClose.sampleSize < MIN_SAMPLE ? med?.deger === null && !!med?.olculemedi : med?.deger === lt.fullClose.medianDays,
      `${med?.deger} / n=${lt.fullClose.sampleSize} medyan ${lt.fullClose.medianDays}`);
    const scE = await getShipmentScorecard(RANGE, null, { destination: "EXPORT" });
    const { sunum: f } = await buildDeadlineReport({ range: RANGE, compareRange: null, compareMode: "none", filters: { destination: "EXPORT" } });
    check("S3e süzgeçli (yön EXPORT): ana = onTimePct ve GERÇEK 0 sıfır kalır", scE.summary.withDeadlineOrders > 0 && f.anaSayi.deger === scE.summary.onTimePct && f.anaSayi.deger === 0,
      `${f.anaSayi.deger} / ${scE.summary.onTimePct}`);
    const scEmpty = await getShipmentScorecard(EMPTY, null, {});
    const { sunum: e } = await buildDeadlineReport({ range: EMPTY, compareRange: null, compareMode: "none", filters: {} });
    check("S3f terminli sipariş yok → ölçülemedi (kaynak 0 verir, temel null)", scEmpty.summary.withDeadlineOrders === 0 && e.anaSayi.deger === null && !!e.anaSayi.olculemedi,
      `${e.anaSayi.deger} / kaynak ${scEmpty.summary.onTimePct}`);
  }

  console.log("── S4 açık siparişler (kesit) ──");
  {
    const src = await getOpenOrderCoverage({ itemId: [itemId] });
    const { sunum: s, suzgec } = await buildOpenOrderReport({ filters: { itemId: [itemId] } });
    shape("S4z", s);
    check("S4a ⭐ süzgeçli (kumaş): ana = warehouseCoveragePct (depodan)", src.summary.openQty > 0 && s.anaSayi.deger === src.summary.warehouseCoveragePct,
      `${s.anaSayi.deger} / ${src.summary.warehouseCoveragePct} (karşılanma toplamı ${src.summary.coveragePct})`);
    check("S4b yan: açık = openQty · termini geçmiş karşılanamayan = overdueUncoveredQty · yeni iş emri = uncoveredQty",
      side(s, "acikSiparis.metre")?.deger === src.summary.openQty
        && side(s, "acikSiparis.gecikmisKarsilanamayan")?.deger === src.summary.overdueUncoveredQty
        && side(s, "acikSiparis.yeniIsEmri")?.deger === src.summary.uncoveredQty);
    check("S4c EK alan = depodan ÷ açık", src.summary.warehouseCoveragePct === Math.round((src.summary.fromWarehouseQty * 1000) / src.summary.openQty) / 10,
      `${src.summary.warehouseCoveragePct} = ${src.summary.fromWarehouseQty}÷${src.summary.openQty}`);
    check("S4d kıyas yok + süzgeç beyanı", s.anaSayi.kiyas === undefined && Array.isArray(suzgec?.itemId));
  }

  console.log("── S5 vazgeçilen iş (iade + iptal) ──");
  {
    const ret = await getReturnScorecard(RANGE, PREV);
    const can = await getOrderCancellationScorecard(RANGE);
    const canPrev = await getOrderCancellationScorecard(PREV);
    const { sunum: s } = await buildLostWorkReport({ range: RANGE, compareRange: PREV, compareMode: "prev" });
    shape("S5z", s);
    const want = Math.round((ret.summary.returnQty + can.summary.cancelledQty) * 10) / 10;
    check("S5a ⭐ ana = iade metre + iptal metre", s.anaSayi.deger === want && want === 80, `${s.anaSayi.deger} / ${ret.summary.returnQty} + ${can.summary.cancelledQty}`);
    check("S5b tablo iki AYRI satır", s.tablo?.satirlar.length === 2 && s.tablo.satirlar[0]!.metre === ret.summary.returnQty && s.tablo.satirlar[1]!.metre === can.summary.cancelledQty);
    check("S5c iptal oranı = cancelRatePct · kıyas = önceki dönem cancelRatePct",
      side(s, "siparis.iptalOrani")?.deger === can.summary.cancelRatePct && side(s, "siparis.iptalOrani")?.kiyas?.deger === canPrev.summary.cancelRatePct,
      `${side(s, "siparis.iptalOrani")?.deger}/${can.summary.cancelRatePct}`);
    check("S5d iade oranı = returnPct · iptal adedi = cancelledCount",
      side(s, "iade.oran")?.deger === ret.summary.returnPct && side(s, "siparis.iptalAdedi")?.deger === can.summary.cancelledCount,
      `${side(s, "iade.oran")?.deger}/${ret.summary.returnPct}`);
  }

  console.log("── S6 K-KIYAS: parametresiz çağrı = önceki dönem ──");
  {
    const { mode, compareRange } = resolveCoreCompare({}, RANGE);
    const ref = resolveCompareRange({ compare: "prev" }, RANGE)!;
    check("S6a `compare` yok → kip prev, aralık = resolveCompareRange(prev)", mode === "prev" && compareRange?.from.getTime() === ref.from.getTime() && compareRange?.to.getTime() === ref.to.getTime());
    const src = await getOrderIntake(RANGE, compareRange, {});
    const { sunum: s } = await buildOrderDemandReport({ range: RANGE, compareRange, compareMode: mode, filters: {} });
    const k = s.parametreler.find((p) => p.ad === "kiyas");
    check("S6b zarf: `kiyas` beyanı = prev · kiyasDonemi dolu · kıyas = prevTotalQty",
      k?.deger === "prev" && (k.secenekler?.length ?? 0) === 4 && !!s.kiyasDonemi && s.anaSayi.kiyas?.deger === src.summary.prevTotalQty,
      `${k?.deger} · ${s.kiyasDonemi?.etiket} · ${s.anaSayi.kiyas?.deger}`);
    const none = resolveCoreCompare({ compare: "none" }, RANGE);
    check("S6c açık `none` → kıyas yok", none.mode === "none" && none.compareRange === null);
  }

  console.log("── S7 iki iptal tanımı (aynı fikstür) ──");
  {
    const intake = await getOrderIntake(RANGE, null, {});
    const can = await getOrderCancellationScorecard(RANGE);
    console.log(`   Sipariş Karnesi cancelledPct (dönemde ALINAN siparişlerden iptal olan, çıpa sipariş tarihi): %${intake.summary.cancelledPct} (${intake.summary.cancelledCount}/${intake.summary.orderCount})`);
    console.log(`   İptal Karnesi cancelRatePct (dönemde İPTAL edilen ÷ dönemde açılan, çıpa iptal anı): %${can.summary.cancelRatePct} (${can.summary.cancelledCount}/${can.summary.openedInPeriod})`);
    check("S7a iki tanım bu fikstürde FARKLI (Ocak'ta alınıp Mart'ta iptal) — temel rapor yalnız ikincisini kullanır",
      intake.summary.cancelledPct === 20 && can.summary.cancelRatePct === 40, `${intake.summary.cancelledPct} ≠ ${can.summary.cancelRatePct}`);
  }
}

async function cleanup(): Promise<void> {
  await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  try {
    const { cD } = await setup();
    await salesSection(cD);
  } finally {
    await cleanup();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  try { await cleanup(); } catch { /* ikinci deneme — kalıntı sonraki koşumda görünür */ }
  await pool.end();
  process.exit(1);
});
