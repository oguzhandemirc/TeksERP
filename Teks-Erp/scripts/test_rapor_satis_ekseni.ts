// =============================================================================
// RAPORLARDA SATIŞ / MÜŞTERİ / FASON EKSENLERİ (raporlar fazı R5b-c) — süzgeçli ↔ süzgeçsiz SAYI FARKI, gerçek DB
// =============================================================================
// NEDEN: sipariş ailesi (5) + müşteri (2) + fason karnesi `customerId` · `destination` · `itemId` · `colorId` ·
// `reasonCode` · `subcontractorId` süzgeci alır (RAPORLAR-ENVANTER §7 "eksik doğal eksen"); tek sözleşme
// `reports/_filters.ts`. Kural: strict Zod + SUNUCU süzmesi + karşılaştırma aralığı ve her payda/seri aynı koşul +
// cevap KÖKÜNDE `suzgec` (tek adres, dokuma dahil) yalnız verilen anahtarlar (yoksa anahtar YOK) + tanınmayan kimlik BOŞ sonuç (404 değil, her eksende).
// §0 Zod/echo (DB'siz) · §1 sipariş karnesi · §2 talep analizi · §3 teslim süresi · §4 iptal karnesi (pay+payda) ·
// §5 açık sipariş karşılanma (yalnız itemId) · §6 müşteri karnesi · §7 sipariş profili · §8 fason karnesi ·
// §9 R5b-b hizası (dokuma kökte `suzgec`, verilmeyen anahtarı basmaz — TEK ADRES) · §10 R5b-c3 `meta.secenekler` seçici
//   kaynağı: pencerede geçen değerler (pencere DIŞI sipariş yok — sonda), süzgeçli yanıtta TAM liste, yalnız o raporun eksenleri, kod dolu ·
// §11 R5b-c4 `dusenSatir`: süzgeçsiz − süzgeçli satır, yalnız süzgeçliyken (süzgeçsiz raporda anahtar YOK), 8 uçta; echo'ya
//   `filterEcho(input, keys, dusenSatir)` ile girer — dokuma/finans ile aynı anahtar ("veri yok" ↔ "süzgeç kesti").
// NEGATİF SONDALAR (2026-09-15, ölçüldü): `orderScopeSql` boş parça döner → §1b/§3b/§4b/§4d ❌ (4) ·
//   `lineScopeWhere` `itemId`yi düşürür → §1c/§2b/§6d ❌ (3) · `filterEcho` her zaman `undefined` → §0d ❌ (1) ·
//   iptal paydası (`openedInPeriod`) `scope`suz → §4b/§4d ❌ (2) · R5b-c3 (ölçüldü): seçenek süzgeçli satırlardan türer
//   (`kaynak = cur`) → §10b ❌ · toplayıcı pencereyi yok sayar (`orderDate` where'den düşer) → §1a/§10a ❌ (OUT tarihli O5 fikstürü) ·
//   R5b-c4 (ölçüldü): `droppedRows` hep `undefined` → §11b/§11d ❌ · `filterEcho` `dusenSatir`ı düşürür → §11c ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Pencere 2097-06 (diğer rapor bekçileri 2095/2099 kullanır).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { resolveShipmentDestination } from "../src/services/helpers/shipment-destination.helper";
import { filterEcho } from "../src/services/reports/_filters";
import { demandAnalysisQuerySchema, openOrderCoverageQuerySchema, orderCancellationQuerySchema, orderIntakeQuerySchema, orderLeadTimeQuerySchema } from "../src/routes/reports/sales.routes";
import { customerScorecardQuerySchema, orderProfileQuerySchema } from "../src/routes/reports/customer.routes";
import { subcontractScorecardQuerySchema } from "../src/routes/reports/subcontract.routes";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";
import { getDemandAnalysis } from "../src/services/reports/demand-analysis.report.service";
import { getOrderLeadTime } from "../src/services/reports/order-leadtime.report.service";
import { getOrderCancellationScorecard } from "../src/services/reports/order-cancellation.report.service";
import { getOpenOrderCoverage } from "../src/services/reports/open-order-coverage.report.service";
import { getCustomerScorecard } from "../src/services/reports/customer-scorecard.report.service";
import { getCustomerOrderProfiles } from "../src/services/reports/customer.report.service";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { efficiencyReport } from "../src/services/reports/dokuma.report.service";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-RSE-${process.pid}`;
const YOK = "00000000-0000-4000-8000-000000000000";
const RANGE = { from: new Date("2097-06-01T00:00:00.000Z"), to: new Date("2097-06-30T23:59:59.999Z") };
const IN = new Date("2097-06-10T09:00:00.000Z");
const OUT = new Date("2097-07-10T09:00:00.000Z");
const REASON = `TEST_RSE_${process.pid}`;

function statik(): void {
  console.log("── §0 Zod + echo (DB'siz) ──");
  const red = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => !s.safeParse(v).success;
  check("§0a kimlik listesi: uuid değil → 400; 51 kimlik → 400; CSV ve tekrarlı anahtar aynı listeye iner", red(orderIntakeQuerySchema, { customerId: "x" }) && red(orderIntakeQuerySchema, { customerId: Array(51).fill(YOK).join(",") }) && JSON.stringify(orderIntakeQuerySchema.parse({ customerId: `${YOK}, ${YOK}` }).customerId) === JSON.stringify(orderIntakeQuerySchema.parse({ customerId: [YOK, YOK] }).customerId));
  check("§0b destination enum dışı 400; bilinmeyen anahtar 400 (sekiz şema strict)", red(orderIntakeQuerySchema, { destination: "MARS" }) && [orderIntakeQuerySchema, demandAnalysisQuerySchema, orderLeadTimeQuerySchema, orderCancellationQuerySchema, openOrderCoverageQuerySchema, customerScorecardQuerySchema, orderProfileQuerySchema, subcontractScorecardQuerySchema].every((s) => red(s, { sunucu: "1" })));
  check("§0c eksen dışı anahtar o uçta 400: karşılanmada customerId, teslimde colorId, fasonda customerId, profilde itemId", red(openOrderCoverageQuerySchema, { customerId: YOK }) && red(orderLeadTimeQuerySchema, { colorId: YOK }) && red(subcontractScorecardQuerySchema, { customerId: YOK }) && red(orderProfileQuerySchema, { itemId: YOK }));
  const e = filterEcho(orderIntakeQuerySchema.parse({ customerId: YOK, destination: "EXPORT" }), ["customerId", "destination", "itemId"]);
  check("§0d echo: yalnız verilen anahtarlar (itemId boş liste → YOK); hiçbiri yoksa undefined", JSON.stringify(e) === JSON.stringify({ customerId: [YOK], destination: "EXPORT" }) && filterEcho(orderIntakeQuerySchema.parse({}), ["customerId", "destination", "itemId"]) === undefined, JSON.stringify(e));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== RAPORLARDA SATIŞ / MÜŞTERİ / FASON EKSENLERİ BEKÇİSİ (R5b-c) ===\n");
  statik();
  const ids = { orders: [] as string[], rolls: [] as string[], dispatchItems: [] as string[], dispatches: [] as string[] };
  const c1 = await prisma.customer.create({ data: { code: `${TAG}-C1`, name: `${TAG} YURTİÇİ`, defaultDestination: "DOMESTIC" }, select: { id: true } });
  const c2 = await prisma.customer.create({ data: { code: `${TAG}-C2`, name: `${TAG} İHRACAT`, defaultDestination: "EXPORT" }, select: { id: true } });
  const c3 = await prisma.customer.create({ data: { code: `${TAG}-C3`, name: `${TAG} PENCERE DIŞI` }, select: { id: true } });
  const i1 = await prisma.item.create({ data: { code: `${TAG}-I1`, name: `${TAG} KUMAŞ1`, itemType: "FABRIC" }, select: { id: true } });
  const i2 = await prisma.item.create({ data: { code: `${TAG}-I2`, name: `${TAG} KUMAŞ2`, itemType: "FABRIC" }, select: { id: true } });
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`, name: `${TAG} fason`, type: "EXTERNAL" }, select: { id: true } });
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true } });
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true } });
  const f1 = await prisma.subcontractor.create({ data: { code: `${TAG}-F1`, name: `${TAG} fasoncu 1` }, select: { id: true } });
  const f2 = await prisma.subcontractor.create({ data: { code: `${TAG}-F2`, name: `${TAG} fasoncu 2` }, select: { id: true } });
  const mkOrder = async (no: string, customerId: string, lines: Array<{ itemId: string; quantity: number }>, cancel?: string, at: Date = IN) => {
    // Sipariş yazar gibi doğar: yön açılışta zincirden donar (2026-09-23; raporlar kolonu okur).
    const destination = (await resolveShipmentDestination(prisma, { customerId })).destination;
    const o = await prisma.order.create({
      data: { orderNumber: `${TAG}-${no}`, customerId, destination, orderDate: at, status: cancel ? "CANCELLED" : "APPROVED", ...(cancel ? { cancelledAt: at, cancelReasonCode: cancel } : {}), lines: { create: lines } },
      select: { id: true },
    });
    ids.orders.push(o.id);
    return o.id;
  };
  const mkDispatch = async (subId: string, itemId: string, qty: number) => {
    const r = await prisma.roll.create({ data: { itemId, initialQty: qty, currentQty: qty, status: "AT_SUBCONTRACTOR", entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${ids.rolls.length}` }, select: { id: true } });
    ids.rolls.push(r.id);
    const d = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-SD${ids.dispatches.length}`, workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: subId, dispatchedAt: IN }, select: { id: true } });
    ids.dispatches.push(d.id);
    const di = await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d.id, rollId: r.id, dispatchedQty: qty }, select: { id: true } });
    ids.dispatchItems.push(di.id);
  };
  const mine = (id: string) => ids.orders.includes(id);
  try {
    // O1 C1 aktif (I1 100 + I2 50) · O2 C2 aktif (I1 30) · O3 C1 İPTAL sebep REASON (I2 20) · O4 C2 İPTAL sebep başka (I1 10)
    const o1 = await mkOrder("O1", c1.id, [{ itemId: i1.id, quantity: 100 }, { itemId: i2.id, quantity: 50 }]);
    const o2 = await mkOrder("O2", c2.id, [{ itemId: i1.id, quantity: 30 }]);
    await mkOrder("O3", c1.id, [{ itemId: i2.id, quantity: 20 }], REASON);
    await mkOrder("O4", c2.id, [{ itemId: i1.id, quantity: 10 }], `${REASON}_B`);
    await mkOrder("O5", c3.id, [{ itemId: i1.id, quantity: 5 }], undefined, OUT); // pencere DIŞI — seçenek listesine GİRMEZ
    await prisma.order.updateMany({ where: { id: ids.orders[4] }, data: { status: "COMPLETED" } }); // açık karşılanma (tüm zamanlar) evrenine de girmesin
    await mkDispatch(f1.id, i1.id, 200);
    await mkDispatch(f2.id, i2.id, 80);

    console.log("\n── §1 Sipariş karnesi (order-intake) ──");
    const s0 = await getOrderIntake(RANGE, null);
    const s1 = await getOrderIntake(RANGE, null, { customerId: [c1.id] });
    const s2 = await getOrderIntake(RANGE, null, { itemId: [i2.id] });
    const s3 = await getOrderIntake(RANGE, null, { destination: "EXPORT" });
    const s4 = await getOrderIntake(RANGE, null, { customerId: [YOK] });
    check("§1a süzgeçsiz: 4 sipariş / 180 m, iki müşteri kırılımda", s0.summary.orderCount === 4 && s0.summary.totalQty === 180 && s0.byCustomer.some((b) => b.key === c1.id) && s0.byCustomer.some((b) => b.key === c2.id), `${s0.summary.orderCount}/${s0.summary.totalQty}`);
    check("§1b ⭐ customerId=C1 → 2 sipariş (1 iptal) / 150 m; kırılımda yalnız C1; günlük seri Σ = 150", s1.summary.orderCount === 2 && s1.summary.cancelledCount === 1 && s1.summary.totalQty === 150 && s1.byCustomer.length === 1 && s1.byCustomer[0]!.key === c1.id && s1.daily.reduce((a, d) => a + d.qty, 0) === 150, `${s1.summary.orderCount}/${s1.summary.totalQty}`);
    check("§1c ⭐ itemId=I2 → I2 kalemi olan siparişler (O1 + iptal O3), KALEM listesi budanır: 1 kalem / 50 m, byItem yalnız I2", s2.summary.orderCount === 2 && s2.summary.lineCount === 1 && s2.summary.totalQty === 50 && s2.byItem.length === 1 && s2.byItem[0]!.key === i2.id, `${s2.summary.orderCount}/${s2.summary.lineCount}/${s2.summary.totalQty}`);
    check("§1d destination=EXPORT → C2'nin 2 siparişi / 30 m", s3.summary.orderCount === 2 && s3.summary.totalQty === 30);
    check("§1e bilinmeyen müşteri → BOŞ (0 sipariş, hata yok)", s4.summary.orderCount === 0 && s4.summary.totalQty === 0 && s4.byCustomer.length === 0);
    const s5 = await getOrderIntake(RANGE, RANGE, { customerId: [c1.id] });
    check("§1f karşılaştırma aralığı da süzülür (prev = aynı pencere → prevQty 150)", s5.byCustomer[0]?.prevQty === 150, String(s5.byCustomer[0]?.prevQty));

    console.log("\n── §2 Talep analizi (demand-analysis) ──");
    const d0 = await getDemandAnalysis(RANGE, null);
    const d1 = await getDemandAnalysis(RANGE, null, { customerId: [c1.id] });
    const d2 = await getDemandAnalysis(RANGE, null, { itemId: [i1.id] });
    const d3 = await getDemandAnalysis(RANGE, null, { destination: "EXPORT" });
    check("§2a süzgeçsiz 180 m / 3 kalem (iptaller dışarıda)", d0.summary.totalQty === 180 && d0.summary.lineCount === 3);
    check("§2b ⭐ customerId=C1 → 150 m / 2 kalem; itemId=I1 → 130 m / 2 kalem, byItem yalnız I1", d1.summary.totalQty === 150 && d1.summary.lineCount === 2 && d2.summary.totalQty === 130 && d2.summary.lineCount === 2 && d2.byItem.length === 1, `${d1.summary.totalQty} · ${d2.summary.totalQty}`);
    check("§2c destination=EXPORT → 30 m; aylık seri kalem sayısı süzülmüş evrende (Σ lineCount ≤ 2)", d3.summary.totalQty === 30 && d3.monthly.every((m) => m.lineCount <= 2));

    console.log("\n── §3 Teslim süresi (order-leadtime) ──");
    const l0 = await getOrderLeadTime(RANGE);
    const l1 = await getOrderLeadTime(RANGE, { customerId: [c1.id] });
    const l2 = await getOrderLeadTime(RANGE, { itemId: [i2.id] });
    const l3 = await getOrderLeadTime(RANGE, { destination: "EXPORT" });
    const rows = (r: typeof l0) => r.orders.filter((o) => mine(o.orderId));
    check("§3a süzgeçsiz 2 aktif sipariş (iptaller yok)", rows(l0).length === 2);
    check("§3b ⭐ C1 → yalnız O1; itemId=I2 → yalnız O1 (iptal O3 dışarıda); EXPORT → yalnız O2", rows(l1).length === 1 && rows(l1)[0]!.orderId === o1 && rows(l2).length === 1 && rows(l2)[0]!.orderId === o1 && rows(l3).length === 1 && rows(l3)[0]!.orderId === o2);

    console.log("\n── §4 İptal karnesi (order-cancellation) — pay VE payda ──");
    const k0 = await getOrderCancellationScorecard(RANGE);
    const k1 = await getOrderCancellationScorecard(RANGE, { customerId: [c1.id] });
    const k2 = await getOrderCancellationScorecard(RANGE, { reasonCode: [REASON] });
    const k3 = await getOrderCancellationScorecard(RANGE, { destination: "EXPORT" });
    check("§4a süzgeçsiz: 2 iptal, 4 açılan, oran %50, iki müşteri", k0.summary.cancelledCount === 2 && k0.summary.openedInPeriod === 4 && k0.summary.cancelRatePct === 50 && k0.byCustomer.length === 2, JSON.stringify([k0.summary.cancelledCount, k0.summary.openedInPeriod, k0.summary.cancelRatePct]));
    check("§4b ⭐ customerId=C1 → 1 iptal / 2 açılan / %50; byCustomer yalnız C1; günlük seri Σ 1", k1.summary.cancelledCount === 1 && k1.summary.openedInPeriod === 2 && k1.summary.cancelRatePct === 50 && k1.byCustomer.length === 1 && k1.daily.reduce((a, d) => a + d.count, 0) === 1);
    check("§4c ⭐ reasonCode → PAY süzülür (1 iptal, O3), PAYDA süzülmez (4 açılan) → %25; sebep listesi tek kod", k2.summary.cancelledCount === 1 && k2.summary.openedInPeriod === 4 && k2.summary.cancelRatePct === 25 && k2.byReason.length === 1 && k2.byReason[0]!.code === REASON, JSON.stringify([k2.summary.cancelledCount, k2.summary.openedInPeriod, k2.summary.cancelRatePct]));
    check("§4d destination=EXPORT → 1 iptal (O4) / 2 açılan", k3.summary.cancelledCount === 1 && k3.summary.openedInPeriod === 2);

    console.log("\n── §5 Açık sipariş karşılanma — yalnız itemId ──");
    const v0 = await getOpenOrderCoverage();
    const v1 = await getOpenOrderCoverage({ itemId: [i1.id] });
    const v2 = await getOpenOrderCoverage({ itemId: [YOK] });
    const kalem = (r: typeof v0) => r.byItem.filter((b) => b.key === i1.id || b.key === i2.id);
    check("§5a süzgeçsiz: I1 ve I2 kırılımda; itemId=I1 → yalnız I1 (130 m açık), bilinmeyen kumaş → boş", kalem(v0).length === 2 && kalem(v1).length === 1 && kalem(v1)[0]!.key === i1.id && kalem(v1)[0]!.openQty === 130 && v2.byItem.length === 0 && v2.summary.openLineCount === 0, `${kalem(v1)[0]?.openQty}`);

    console.log("\n── §6 Müşteri karnesi (customer-scorecard) ──");
    const m0 = await getCustomerScorecard(RANGE, null);
    const m1 = await getCustomerScorecard(RANGE, null, { customerId: [c1.id] });
    const m2 = await getCustomerScorecard(RANGE, null, { destination: "EXPORT" });
    const m3 = await getCustomerScorecard(RANGE, null, { itemId: [i2.id] });
    const rank = (r: typeof m0, id: string) => r.ranking.find((x) => x.customerId === id);
    check("§6a süzgeçsiz: C1 150 m ve C2 30 m sıralamada", rank(m0, c1.id)?.totalQty === 150 && rank(m0, c2.id)?.totalQty === 30);
    check("§6b ⭐ customerId=C1 → sıralama tek satır (C1), customerCount 1, C2 yok", m1.ranking.length === 1 && m1.ranking[0]!.customerId === c1.id && m1.summary.customerCount === 1 && !rank(m1, c2.id));
    check("§6c destination=EXPORT → C2 var, C1 yok (dönem + ömür boyu aynı koşul)", !!rank(m2, c2.id) && !rank(m2, c1.id));
    check("§6d ⭐ itemId=I2 → C1 50 m (I1 kalemi düştü), C2 sıralamada YOK (I2 siparişi yok)", rank(m3, c1.id)?.totalQty === 50 && !rank(m3, c2.id), String(rank(m3, c1.id)?.totalQty));

    console.log("\n── §7 Sipariş profili (order-profile) ──");
    const p0 = (await getCustomerOrderProfiles()).rows;
    const p1 = (await getCustomerOrderProfiles({ customerId: [c1.id] })).rows;
    const p2 = (await getCustomerOrderProfiles({ destination: "EXPORT" })).rows;
    const prof = (r: typeof p0, id: string) => r.find((x) => x.customerId === id);
    check("§7a süzgeçsiz ikisi de listede (limit 200 içinde olmayabilir → en az biri) ; C1 → tek satır C1; EXPORT → C2 var C1 yok", (!!prof(p0, c1.id) || !!prof(p0, c2.id)) && p1.length === 1 && p1[0]!.customerId === c1.id && !!prof(p2, c2.id) && !prof(p2, c1.id));

    console.log("\n── §8 Fason karnesi (subcontract-scorecard) ──");
    const f0 = await getSubcontractScorecard(RANGE, null);
    const fa = await getSubcontractScorecard(RANGE, null, { subcontractorId: [f1.id] });
    const fb = await getSubcontractScorecard(RANGE, null, { itemId: [i2.id] });
    const fc = await getSubcontractScorecard(RANGE, null, { subcontractorId: [f1.id], itemId: [i2.id] });
    const sub = (r: typeof f0, id: string) => r.bySubcontractor.find((x) => x.key === id);
    check("§8a süzgeçsiz: F1 200 m, F2 80 m; açık listede ikisi de", sub(f0, f1.id)?.dispatchedQty === 200 && sub(f0, f2.id)?.dispatchedQty === 80 && f0.oldestOpen.some((o) => o.subcontractorName.includes("fasoncu 1")) && f0.oldestOpen.some((o) => o.subcontractorName.includes("fasoncu 2")));
    check("§8b ⭐ subcontractorId=F1 → yalnız F1 (200 m), toplam 200, açık listede F2 YOK", fa.bySubcontractor.length === 1 && fa.summary.dispatchedQty === 200 && !fa.oldestOpen.some((o) => o.subcontractorName.includes("fasoncu 2")), `${fa.summary.dispatchedQty}`);
    check("§8c itemId=I2 → yalnız F2 (topun kumaşı); F1 ∩ I2 → boş", fb.bySubcontractor.length === 1 && fb.bySubcontractor[0]!.key === f2.id && fc.bySubcontractor.length === 0 && fc.summary.dispatchedQty === 0);

    console.log("\n── §10 R5b-c3 `meta.secenekler` seçici kaynağı ──");
    const idsOf = (l: Array<{ id: string }> | undefined) => (l ?? []).map((x) => x.id);
    const has = (l: Array<{ id: string }> | undefined, id: string) => idsOf(l).includes(id);
    const sc0 = s0.secenekler;
    check("§10a ⭐ sipariş karnesi süzgeçsiz: müşteri C1+C2 (adlı), kumaş I1+I2 (kodlu); pencere DIŞI C3 YOK; yalnız kendi eksenleri (colorId/subcontractorId/reasonCode anahtarı yok)", has(sc0.customerId, c1.id) && has(sc0.customerId, c2.id) && !has(sc0.customerId, c3.id) && sc0.customerId!.every((x) => x.ad.length > 0) && has(sc0.itemId, i1.id) && has(sc0.itemId, i2.id) && sc0.itemId!.every((x) => !!x.kod) && !("colorId" in sc0) && !("subcontractorId" in sc0) && !("reasonCode" in sc0), JSON.stringify(Object.keys(sc0)));
    check("§10b ⭐ süzgeçli yanıtta TAM liste (customerId=C1 → seçenekte C2 de var; itemId=I2 → seçenekte I1 de var)", has(s1.secenekler.customerId, c2.id) && has(s2.secenekler.itemId, i1.id) && has(s3.secenekler.customerId, c1.id));
    check("§10c talep analizi: customerId/itemId/colorId eksenleri; renk fikstürde yok → colorId []", has(d0.secenekler.customerId, c1.id) && has(d0.secenekler.itemId, i2.id) && Array.isArray(d0.secenekler.colorId) && d0.secenekler.colorId!.length === 0 && has(d1.secenekler.customerId, c2.id));
    check("§10d teslim süresi: müşteri C1+C2, kumaş kodlu; süzgeçli tam liste", has(l0.secenekler.customerId, c2.id) && has(l0.secenekler.itemId, i2.id) && l0.secenekler.itemId!.every((x) => !!x.kod) && has(l1.secenekler.customerId, c2.id));
    check("§10e iptal karnesi: müşteri C1+C2 (iptal satırlarından), reasonCode iki kod (etiket katalogda yok → kodun kendisi); süzgeçli tam liste", has(k0.secenekler.customerId, c1.id) && has(k0.secenekler.customerId, c2.id) && (k0.secenekler.reasonCode ?? []).some((r) => r.code === REASON && r.ad === REASON) && (k0.secenekler.reasonCode ?? []).length >= 2 && (k2.secenekler.reasonCode ?? []).some((r) => r.code === `${REASON}_B`) && !("itemId" in k0.secenekler));
    check("§10f açık karşılanma: yalnız itemId ekseni (I1+I2 kodlu), customerId anahtarı YOK; süzgeçli de tam", has(v0.secenekler.itemId, i1.id) && has(v0.secenekler.itemId, i2.id) && !("customerId" in v0.secenekler) && has(v1.secenekler.itemId, i2.id));
    check("§10g müşteri karnesi: müşteri C1+C2, kumaş kodlu; destination=EXPORT süzgeçli yanıtta C1 de listede", has(m0.secenekler.customerId, c1.id) && has(m0.secenekler.itemId, i2.id) && m0.secenekler.itemId!.every((x) => !!x.kod) && has(m2.secenekler.customerId, c1.id));
    const pr = await getCustomerOrderProfiles({ customerId: [c1.id] });
    check("§10h sipariş profili: seçenek = süzgeçsiz koşunun satırları (C1 kodlu; süzgeçli istekte C2 de listede)", pr.rows.length === 1 && has(pr.secenekler.customerId, c2.id) && pr.secenekler.customerId!.find((x) => x.id === c1.id)?.kod === `${TAG}-C1`);
    check("§10i fason karnesi: fasoncu F1+F2, kumaş I1+I2 kodlu, colorId []; süzgeçli (F1) yanıtta F2 de listede", has(f0.secenekler.subcontractorId, f2.id) && has(f0.secenekler.itemId, i2.id) && f0.secenekler.itemId!.every((x) => !!x.kod) && Array.isArray(f0.secenekler.colorId) && has(fa.secenekler.subcontractorId, f2.id));

    console.log("\n── §11 R5b-c4 `dusenSatir` — süzgeç kesti mi ──");
    check("§11a ⭐ süzgeçsiz raporda `dusenSatir` anahtarı YOK (8 uç)", [s0, d0, l0, k0, v0, m0, f0].every((r) => !("dusenSatir" in r) || r.dusenSatir === undefined) && (await getCustomerOrderProfiles()).dusenSatir === undefined);
    check("§11b ⭐ süzgeçli: intake C1 → 4−2=2 · demand I1 → 3−2=1 · leadtime EXPORT → 2−1=1 · iptal C1 → 2−1=1 · karne EXPORT → 2−1=1 · fason F1 → 2−1=1 · karşılanma I1 → açık kalem 3−2=1 · profil C1 → n−1", s1.dusenSatir === 2 && d2.dusenSatir === 1 && l3.dusenSatir === 1 && k1.dusenSatir === 1 && m2.dusenSatir === 1 && fa.dusenSatir === 1 && v1.dusenSatir === 1 && pr.dusenSatir !== undefined && pr.dusenSatir >= 1, JSON.stringify([s1.dusenSatir, d2.dusenSatir, l3.dusenSatir, k1.dusenSatir, m2.dusenSatir, fa.dusenSatir, v1.dusenSatir, pr.dusenSatir]));
    check("§11c echo: `filterEcho(input, keys, 2)` → `{…, dusenSatir: 2}`; süzgeç yokken sayı verilse de yankı YOK; süzgeçli ama sayı undefined → anahtar yok", JSON.stringify(filterEcho(orderIntakeQuerySchema.parse({ customerId: YOK }), ["customerId"], 2)) === JSON.stringify({ customerId: [YOK], dusenSatir: 2 }) && filterEcho(orderIntakeQuerySchema.parse({}), ["customerId"], 2) === undefined && !("dusenSatir" in (filterEcho(orderIntakeQuerySchema.parse({ customerId: YOK }), ["customerId"]) ?? {})));
    check("§11d bilinmeyen müşteri → dusenSatir = tüm satırlar (4), rapor boş", s4.dusenSatir === 4 && s4.summary.orderCount === 0);

    console.log("\n── §9 R5b-b hizası: dokuma kökte `suzgec` (tek adres), verilmeyen anahtarı basmaz ──");
    const ymd = factoryYmd(new Date(Date.UTC(1993, 5, 6, 12)));
    const dk = await efficiencyReport({ from: ymd, to: ymd, lotNo: `${TAG}-YOK` });
    check("§9a lotNo ile süzülen dokuma raporunda kökte suzgec = {lotNo, levent, dusenSatir}; `warpBeamId` anahtarı YOK (null bile değil); meta'da suzgec YOK", !!dk.suzgec && dk.suzgec.lotNo === `${TAG}-YOK` && !("warpBeamId" in dk.suzgec) && dk.suzgec.levent === 0 && !("suzgec" in dk.meta), JSON.stringify(dk.suzgec));
  } finally {
    await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.rolls, ...ids.orders] } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.batch.deleteMany({ where: { id: batch.id } });
    await prisma.workOrderStep.deleteMany({ where: { id: step.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.id } });
    await prisma.subcontractor.deleteMany({ where: { id: { in: [f1.id, f2.id] } } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.item.deleteMany({ where: { id: { in: [i1.id, i2.id] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [c1.id, c2.id, c3.id] } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
