// =============================================================================
// TEMEL RAPOR SAYI EŞİTLİĞİ — Raporlar v2 R0 (gerçek DB)
// =============================================================================
// NEDEN: temel raporlar (`services/reports/temel/*`) YENİ SQL yazmaz; her ana/yan sayı mevcut bir
// karnenin alanıdır (plan §2 P2). Bu bekçi her sayıyı AYNI parametreyle kaynağıyla ölçer — sunum
// katmanı kendi hesabını yaparsa (ağırlık, payda, kova) eski raporla ayrışır ve kırmızı olur.
//
// § Satış (RAPA): S1 sipariş-talep · S2 sevkiyat · S3 termin · S4 açık siparişler · S5 vazgeçilen iş
//   · S6 K-KIYAS (parametresiz çağrı = önceki dönem kıyası) · S7 iki iptal tanımı (ölçülür, basılır).
// NEGATİF SONDALAR (2026-10-24, md5 ile geri alındı → 34/0): ① `termin.temel.ts` ana sayısı terminsizleri
//   paydaya kattı → S3a ❌ (33.3 ≠ 50) · ② `sevkiyat.temel.ts` ana sayısı `_shipped` yerine Sevk & Termin
//   `daily` NET serisinden okundu → S2a ❌ (340 ≠ 350) + S2e ❌ · ③ `vazgecilen-is` ana sayısından iade
//   düşürüldü → S5a ❌ (70 ≠ 80). ⚠️ KÖR: `acik-siparisler` ana sayısının `coveragePct`e bağlanması bu
//   fikstürde YAKALANMAZ (üretimde pay 0 → iki oran eşit); EK alanın formülünü S4c ölçer.
//   ⚠️ Pencere 2097-03 (kıyas 2097-02), boş pencere 2096-06, etiket TEST-TRE-<pid>-S; bölüm kendi fikstürünü kurar ve temizler.
// § Üretim/kalite/depo/fason (RAPB) — `production/uretim-akisi`, `quality/kalite`, `quality/kayip`,
//   `inventory/depo`, `subcontract/fasoncular`:
//   • parametresiz çağrı = ÖNCEKİ DÖNEM kıyası (K-KIYAS; `kiyas` beyanı + `kiyasDonemi`).
//   • kalite 1. kalite payı METRE ağırlıklı (fikstürde metre ve top payı AYRIŞIR).
//   • kayıp: her kaynak satırı = kaynak karnesi; fason yalnız KAPANMIŞ kalem (fikstürde açık kalem var);
//     TOPLAM ORAN hiçbir blokta yok (yan sayı · tablo toplamı · grafik).
//   • fasoncular ana sayı = ortalama dönüş süresi (K-FASON); süzgeçli vaka (fasoncu).
//   • operatör görünümü `kisiAdi:true` SUNUMDA taşır (K-KISI); istasyon görünümü taşımaz.
// NEGATİF SONDALAR (2026-10-24, md5 ile geri alındı → yeşil):
//   ① kayıpta fason `fireQty + openQty` → ❌ 2 (§R3b kaynak eşitliği + §R3c ana toplam)
//   ② kalite payı top adediyle ağırlıklandı → ❌ 3 (§R2a kaynak eşitliği + §R2b metre beklentisi + §R2e süzgeçli)
//   ③ kayıp tablosunun `toplam` satırına oran (fire / payda toplamı) eklendi → ❌ 1 (§R3e toplam oran yok)
//   • TABLO eşitliği (2026-11-12, RAPB açılışı — eski ekranlar kalkmadan önce): istasyon (§R1f) · operatör (§R1g) ·
//     kalite 3 görünüm (§R2f) · depo kumaş (§R4d) · fasoncu (§R5f) = eski karnenin satırları hücre hücre.
//     Sonda: geçen metre ← bekleyen metre → ❌ §R1f · fasonda bekleyen ← gönderilen → ❌ §R5f · depo metre ← top → ❌ §R4d.
//
// § Dokuma/finans (RAPC) — `dokuma/tezgah-randimani`, `dokuma/duruslar`, `dokuma/levent-dengesi`, `finance/alacaklar`:
//   • modül kapısı kaynak raporunkiyle aynı (dokuma · levent ayrıca devere · finans) — Express yığınındaki
//     GERÇEK fonksiyonlar koşar; kapalı bayrakta 403 `details.code`=MODULE_DISABLED (test DB'de bayrak geçici).
//   • randıman TEK oran (`toplam.effectivenessPct`), duruş = Pareto toplamı (dakika), müdahale = `ustlenmeOrtSn`.
//   • vardiya süzgeci: tüm vardiyalar = süzgeçsiz, tek vardiya = kaynağın aynı süzgeçli değeri, bilinmeyen 404.
//   • levent dengesi: beklenen kumaşı bilinmeyen levent orana 0 metre olarak GİRMEZ, ayrı sayılır.
//   • alacaklar: para birimleri toplanmaz; kesit kıyası "ölçülemedi" + ay sonu uyarısı.
// NEGATİF SONDALAR (2026-10-25, md5 ile geri alındı → yeşil):
//   ④ levent ucundan `requireDevereEnabled` kaldırıldı → ❌ 2 (§C0b zincir + §C0d devere kapalıyken 403)
//   ⑤ `beamBalance` ölçülemeyen leventi 0 beklenenle saydı → ❌ 1 (§C3a; oran %140)
// Temiz koşum 97/0 (§ Satış 34 + §V 8 + RAPB/RAPC 55).
//
// § Görünüm (D2, 2026-11-12) — S5v + §G: raporların `gorunum` tablo seçimi = eski raporun listesi hücre hücre.
// NEGATİF SONDALAR (md5 ile geri alındı → 135/0): iade kumaş ← byColor (S5v5) · hız payı ← çalışma payı (§G1s) ·
//   hol ← tezgahlar (§G2t) · otomatik/elle takası (§G3s) · sıfır açık satır süzgeci kaldırıldı (§G4s) → ❌ 5.
// ⚠️ KÖR: RAPC penceresinde tezgah/alarm/levent/alacak verisi yok → gerçek DB kıyası boş kümede; eşleme sentetik satırla.
// S1v (2026-11-12, Talep Analizi emekli): sipariş-talep görünümleri = `getDemandAnalysis` listeleri; sonda kumaş ← byColor
//   + çeşit müşteri ← kalem → ❌ 2 (S1v1 · S1v3), md5 ile geri alındı.
//
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Pencere 2097-07 (kıyas 2097-06), etiket TEST-TRE-<pid>.
// Koşum: npx tsx scripts/test_temel_rapor_esitlik.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { firstGrade, roleGrade } from "./fixture-quality-grade";
import type { DateRange } from "../src/services/reports/_shared";
import type { AnaSayi, RaporSunumu } from "../src/services/reports/sunum/sunum.types";
import { resolveCoreCompare } from "../src/services/reports/temel/_common";
import { buildProductionFlowReport } from "../src/services/reports/temel/uretim-akisi.temel";
import { buildQualityReport } from "../src/services/reports/temel/kalite.temel";
import { buildLossReport, collectLossSources } from "../src/services/reports/temel/kayip.temel";
import { buildWarehouseReport, NO_MONTH_END_SNAPSHOT } from "../src/services/reports/temel/depo.temel";
import { buildSubcontractorsReport } from "../src/services/reports/temel/fasoncular.temel";
import { getWipScorecard } from "../src/services/reports/wip-scorecard.report.service";
import { getOperatorPerformance } from "../src/services/reports/production.report.service";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";
import { getPlanDeviationScorecard } from "../src/services/reports/plan-deviation-scorecard.report.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { beamResultReport } from "../src/services/reports/levent-sonucu.report.service";
import { readDevereEnabled, readDokumaEnabled } from "../src/services/system-setting.service";
import { REPORT_BY_KEY, type ReportKey } from "../src/constants/report-catalog";
import { permissionOf } from "../src/routes/reports/temel-uretim.routes";
import type { Currency, ShipmentDestination } from "@prisma/client";
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
import { buildOrderDemandReport } from "../src/services/reports/temel/siparis-talep.temel";
import { ORDER_DEMAND_VIEWS, type OrderDemandView } from "../src/services/reports/temel/siparis-talep.views";
import { getDemandAnalysis } from "../src/services/reports/demand-analysis.report.service";
import { getCustomerOrderProfiles } from "../src/services/reports/customer.report.service";
import { buildShippedReport } from "../src/services/reports/temel/sevkiyat.temel";
import { buildDeadlineReport } from "../src/services/reports/temel/termin.temel";
import { buildOpenOrderReport } from "../src/services/reports/temel/acik-siparisler.temel";
import { buildLostWorkReport, LOST_WORK_VIEWS, type LostWorkView } from "../src/services/reports/temel/vazgecilen-is.temel";
import coreWeavingFinanceRouter, { permissionOf as rapcPermissionOf } from "../src/routes/reports/temel-dokuma-finans.routes";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { buildLoomEfficiencyReport, capacityDetailTable, efficiencyReasonText, shiftRowsTable } from "../src/services/reports/temel/tezgah-randimani.temel";
import { buildLoomStopsReport, LOOM_STOP_VIEWS, mostFrequentReason, responseRowsOf, responseTable, secondsToMinutes } from "../src/services/reports/temel/duruslar.temel";
import { beamBalance, buildBeamBalanceReport, closedBeamDetailTable, openBeamTable } from "../src/services/reports/temel/levent-dengesi.temel";
import { agingBucketTable, buildReceivablesReport, mainBlock, MONTH_END_REBUILT, NO_MONTH_END_RECEIVABLES, receivedChequesDue } from "../src/services/reports/temel/alacaklar.temel";
import { factoryPreviousMonthEnd } from "../src/services/reports/temel/_day-range";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { durusParetoReport, efficiencyReport, shiftScorecardReport, type EfficiencyRow } from "../src/services/reports/dokuma.report.service";
import { SHIFT_STAT_PAGE_MAX } from "../src/services/machine-shift-stat.service";
import type { BeamResultRow } from "../src/services/reports/levent-sonucu.report.service";
import type { AlarmResponseRow } from "../src/services/reports/alarm-response.report.service";
import { capacityUsageReport } from "../src/services/reports/kapasite-kullanimi.report.service";
import { alarmResponseReport } from "../src/services/reports/alarm-response.report.service";
import { getAgingReport } from "../src/services/reports/finance-aging.report";
import { chequeService } from "../src/services/cheque.service";
import { yasakSozcukBul } from "../src/services/reports/anlati/yasak-sozcuk";
import { periodRanges, runCoreWithExtras } from "../src/services/reports/temel/_variant";
import { factoryDateTr, factoryDayEndOfKey } from "../src/constants/time";
import { ORDER_DEMAND_DIMS, OPEN_ORDER_DIMS, SHIPPED_DIMS, SUBCONTRACTOR_DIMS, openOrderRunner, orderDemandRunner, shippedRunner, subcontractorRunner, type OrderDemandFilters } from "../src/services/reports/temel/core-runs";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const same = (a: number | null | undefined, b: number | null | undefined): boolean =>
  (a ?? null) === (b ?? null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
const show = (a: unknown, b: unknown): string => `temel ${JSON.stringify(a)} · kaynak ${JSON.stringify(b)}`;
const fig = (s: RaporSunumu, olcu: string): AnaSayi | undefined => [s.anaSayi, ...s.yanSayilar].find((f) => f.olcu === olcu);
// Görünüm tablosu = eski raporun listesi HÜCRE HÜCRE; beklenen eşleme bu dosyada BAĞIMSIZ yazılır (kurucu kopyalanmaz).
function cellsMatch(label: string, s: RaporSunumu, want: ReadonlyArray<Record<string, unknown>>, nonEmpty = false): void {
  const got = s.tablo?.satirlar ?? [];
  const bad = want.findIndex((w, i) => Object.entries(w).some(([k, v]) => JSON.stringify(got[i]?.[k] ?? null) !== JSON.stringify(v ?? null)));
  const ok = got.length === want.length && bad === -1 && !s.tablo?.kesildi && (!nonEmpty || want.length > 0);
  check(label, ok, `satır ${got.length}/${want.length}${bad >= 0 ? ` · ilk fark ${bad}: ${JSON.stringify(got[bad])} ≠ ${JSON.stringify(want[bad])}` : ""}`);
}
const viewDecl = (s: RaporSunumu) => s.parametreler.find((p) => p.ad === "gorunum");

const TAG = `TEST-TRE-${process.pid}`;
const RANGE: DateRange = { from: new Date("2097-07-01T00:00:00.000Z"), to: new Date("2097-07-31T23:59:59.999Z") };
const IN_WINDOW = new Date("2097-07-15T10:00:00.000Z");
const SENT = new Date("2097-07-05T08:00:00.000Z");
const BACK = new Date("2097-07-09T08:00:00.000Z"); // 4 gün
const PREV_SENT = new Date("2097-06-05T08:00:00.000Z");
const PREV_BACK = new Date("2097-06-15T08:00:00.000Z"); // 10 gün

const ids = {
  receiptItems: [] as string[], receipts: [] as string[], dispatchItems: [] as string[], dispatches: [] as string[],
  rolls: [] as string[], batches: [] as string[], steps: [] as string[], wos: [] as string[], subs: [] as string[], stations: [] as string[], items: [] as string[],
};

async function rapbFixture(): Promise<{ subId: string; otherSubId: string }> {
  // Fikstür İŞ ANAHTARIYLA kurulur (ortamdaki "herhangi bir kumaş"a yaslanmaz — test_keyfi_arama).
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `Eşitlik ${TAG}`, itemType: "FABRIC" }, select: { id: true } });
  ids.items.push(item.id);
  const top = await firstGrade();
  const other = await roleGrade("SECOND");

  const roll = async (qty: number, status: "WAREHOUSE" | "A1_STOCK" | "SCRAP" | "AT_SUBCONTRACTOR", gradeId: string | null, finalizedAt: Date | null) => {
    const r = await prisma.roll.create({
      data: { itemId: item.id, initialQty: qty, currentQty: qty, status, entrySource: "SUPPLIER_RECEIPT", qualityGradeId: gradeId, finalizedAt, barcode: `${TAG}-R${ids.rolls.length}` },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  // Kalite: 1 top × 1000 m birinci + 3 top × 50 m ikinci + 1 top × 20 m hurda → metre payı 1000/1170, top payı 1/5.
  await roll(1000, "WAREHOUSE", top.id, IN_WINDOW);
  for (let i = 0; i < 3; i++) await roll(50, "A1_STOCK", other.id, IN_WINDOW);
  await roll(20, "SCRAP", other.id, IN_WINDOW);

  // Fason: 100 m gitti → 90 m döndü (kapanmış, fark 10) + 200 m AÇIK; ikinci fasoncu yalnız açık 70 m.
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`, name: `Eşitlik ${TAG}`, type: "EXTERNAL" }, select: { id: true } });
  ids.stations.push(station.id);
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  ids.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true } });
  ids.steps.push(step.id);
  // WIP (D1 §R1f): istasyonda bekleyen 1 top (çıkışsız) + pencerede geçen 1 top — istasyon tablosu boş kalmasın.
  for (const [i, exitedAt] of [[0, null], [1, IN_WINDOW]] as const) {
    const wr = await prisma.roll.create({
      data: { itemId: item.id, initialQty: 40 + i, currentQty: 40 + i, status: "IN_PRODUCTION", entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-W${i}` },
      select: { id: true },
    });
    ids.rolls.push(wr.id);
    await prisma.rollMovement.create({ data: { rollId: wr.id, workOrderStepId: step.id, qtyIn: 40 + i, enteredAt: exitedAt ? new Date(IN_WINDOW.getTime() - 3_600_000) : new Date(), exitedAt } });
  }
  const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true } });
  ids.batches.push(batch.id);
  const subA = await prisma.subcontractor.create({ data: { code: `${TAG}-A`, name: `Boyahane A ${TAG}` }, select: { id: true } });
  const subB = await prisma.subcontractor.create({ data: { code: `${TAG}-B`, name: `Boyahane B ${TAG}` }, select: { id: true } });
  ids.subs.push(subA.id, subB.id);

  const dispatch = async (subId: string, at: Date, qtys: number[]): Promise<string[]> => {
    const d = await prisma.subcontractorDispatch.create({
      data: { dispatchNo: `${TAG}-SD${ids.dispatches.length}`, workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: subId, dispatchedAt: at },
      select: { id: true },
    });
    ids.dispatches.push(d.id);
    const out: string[] = [];
    for (const q of qtys) {
      const rid = await roll(q, "AT_SUBCONTRACTOR", null, null);
      const di = await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d.id, rollId: rid, dispatchedQty: q }, select: { id: true } });
      ids.dispatchItems.push(di.id);
      out.push(di.id);
    }
    return out;
  };
  const receipt = async (subId: string, at: Date, srcItemId: string, qty: number): Promise<void> => {
    const r = await prisma.subcontractorReceipt.create({
      data: { receiptNo: `${TAG}-SR${ids.receipts.length}`, subcontractorId: subId, workOrderId: wo.id, stepId: step.id, receivedAt: at },
      select: { id: true },
    });
    ids.receipts.push(r.id);
    const newRoll = await roll(qty, "AT_SUBCONTRACTOR", null, null);
    const ri = await prisma.subcontractorReceiptItem.create({ data: { receiptId: r.id, newRollId: newRoll, sourceDispatchItemId: srcItemId }, select: { id: true } });
    ids.receiptItems.push(ri.id);
  };
  const [a1] = await dispatch(subA.id, SENT, [100, 200]);
  await receipt(subA.id, BACK, a1!, 90);
  await dispatch(subB.id, SENT, [70]);
  const [p1] = await dispatch(subA.id, PREV_SENT, [100]);
  await receipt(subA.id, PREV_BACK, p1!, 95);
  return { subId: subA.id, otherSubId: subB.id };
}

async function rapbSection(): Promise<void> {
  console.log("\n── § Üretim/kalite/depo/fason (RAPB) ──");
  const coreKeys: ReportKey[] = ["production/uretim-akisi", "quality/kalite", "quality/kayip", "inventory/depo", "subcontract/fasoncular"];
  const permDrift = coreKeys.filter((k) => REPORT_BY_KEY.get(k)?.izin !== permissionOf(k));
  check("§R0z uç izni = katalog satırının `izin`i (beş uç)", permDrift.length === 0, permDrift.join(", ") || "birebir");
  const { subId } = await rapbFixture();
  // Parametresiz çağrı: rota `resolveCoreCompare(input)` ile aynı yolu izler.
  const { mode, compareRange } = resolveCoreCompare({}, RANGE);

  // §R0 K-KIYAS — parametresiz = önceki dönem
  check("§R0a parametresiz kıyas kipi `prev` ve kıyas aralığı dolu", mode === "prev" && compareRange !== null, `kip ${mode}`);
  const flow = (await buildProductionFlowReport({ range: RANGE, compareRange, compareMode: mode })).sunum;
  const kiyas = flow.parametreler.find((p) => p.ad === "kiyas");
  check("§R0b ⭐ `parametreler[]` `kiyas` beyanı uygulanan kipi taşır + `kiyasDonemi` dolu",
    kiyas?.deger === "prev" && (kiyas.secenekler?.length ?? 0) >= 2 && flow.kiyasDonemi !== undefined,
    `kiyas ${JSON.stringify(kiyas?.deger)} · kiyasDonemi ${flow.kiyasDonemi ? "var" : "YOK"}`);
  const none = resolveCoreCompare({ kiyas: "none" }, RANGE);
  const flowNone = (await buildProductionFlowReport({ range: RANGE, compareRange: none.compareRange, compareMode: none.mode })).sunum;
  check("§R0c `kiyas=none` açıkça istenirse kıyas yok, beyan `none`",
    flowNone.kiyasDonemi === undefined && flowNone.parametreler.find((p) => p.ad === "kiyas")?.deger === "none");

  // §R1 Üretim akışı = WIP karnesi (+ operatör iş hacmi)
  const wip = await getWipScorecard(RANGE);
  const wipPrev = await getWipScorecard(compareRange!);
  check("§R1a ana sayı = `WipScorecard.summary.waitingCount`", same(flow.anaSayi.deger, wip.summary.waitingCount), show(flow.anaSayi.deger, wip.summary.waitingCount));
  const passed = fig(flow, "uretim.gecenMetre");
  check("§R1b geçen metre (+önceki) = `summary.passedQty`", same(passed?.deger, wip.summary.passedQty) && same(passed?.kiyas?.deger, wipPrev.summary.passedQty),
    show([passed?.deger, passed?.kiyas?.deger], [wip.summary.passedQty, wipPrev.summary.passedQty]));
  check("§R1c ortalama bekleme = `summary.avgWaitDays`", same(fig(flow, "uretim.ortalamaBeklemeGun")?.deger, wip.summary.avgWaitDays));
  const opView = (await buildProductionFlowReport({ range: RANGE, compareRange, compareMode: mode, view: "operator" })).sunum;
  const ops = await getOperatorPerformance(RANGE, 50);
  check("§R1d operatör tablosu = `getOperatorPerformance(range, 50)` (satır + toplam iş)",
    (opView.tablo?.satirlar.length ?? 0) === ops.length && opView.tablo!.satirlar.every((r, i) => r.toplam === ops[i]!.totalOps),
    `${opView.tablo?.satirlar.length} / ${ops.length}`);
  check("§R1e ⭐ K-KISI: operatör görünümü `kisiAdi:true` SUNUMDA, istasyon görünümü taşımaz",
    opView.kisiAdi === true && flow.kisiAdi === undefined);
  // D1 (eski rapor kaldırma): eski WIP ekranının istasyon tablosu yeni raporda HÜCRE HÜCRE aynı olmalı.
  const flowRows = flow.tablo?.satirlar ?? [];
  const wipRowDrift = wip.byStation.filter((s, i) => {
    const r = flowRows[i];
    return !r || r.istasyon !== s.label || !same(r.bekleyenTop as number, s.waitingCount) || !same(r.bekleyenMetre as number, s.waitingQty)
      || !same(r.enEski as number | null, s.oldestDays) || !same(r.ortBekleme as number | null, s.avgWaitDays)
      || !same(r.gecenTop as number, s.passedCount) || !same(r.gecenMetre as number, s.passedQty) || !same(r.kalis as number | null, s.avgDurationHours);
  });
  check("§R1f ⭐ istasyon tablosu = eski WIP karnesi `byStation` (satır sayısı + 8 kolon hücre hücre)",
    flowRows.length === wip.byStation.length && wip.byStation.length > 0 && wipRowDrift.length === 0,
    `${flowRows.length}/${wip.byStation.length} satır · sapan ${wipRowDrift.map((s) => s.label).join(", ") || "yok"}`);
  const opRowDrift = ops.filter((o, i) => {
    const r = opView.tablo?.satirlar[i];
    return !r || !same(r.kursun as number, o.kursunCount) || !same(r.kalite as number, o.qc2Count) || !same(r.tambur as number, o.tamburCount) || !same(r.fason as number, o.subcontractorOps);
  });
  check("§R1g operatör tablosu kolonları = eski Operatör İş Hacmi (kurşun · kalite · tambur · fason)", opRowDrift.length === 0, `sapan ${opRowDrift.length}`);

  // §R2 Kalite = kalite + hurda + plan dışı karneleri
  const quality = (await buildQualityReport({ range: RANGE, compareRange, compareMode: mode, filters: {} })).sunum;
  const qc = await getQualityScorecard(RANGE, compareRange);
  const sc = await getScrapScorecard(RANGE, compareRange);
  const dev = await getPlanDeviationScorecard(RANGE, compareRange);
  check("§R2a ⭐ 1. kalite payı = `QualityScorecard.summary.topGrade.pct`", same(quality.anaSayi.deger, qc.summary.topGrade?.pct), show(quality.anaSayi.deger, qc.summary.topGrade?.pct));
  const metreWeighted = Math.round((1000 / 1170) * 1000) / 10;
  check("§R2b ⭐ pay METRE ağırlıklı (fikstür 1000/1170 m; top adediyle 1/5 olurdu)",
    typeof quality.anaSayi.deger === "number" && Math.abs(quality.anaSayi.deger - metreWeighted) < 0.15, `${quality.anaSayi.deger} ≈ ${metreWeighted}`);
  check("§R2c 1000 m'de hata (+önceki) = `ScrapScorecardSummary.defectsPerThousandM`",
    same(fig(quality, "kalite.binMetredeHata")?.deger, sc.summary.defectsPerThousandM) && same(fig(quality, "kalite.binMetredeHata")?.kiyas?.deger, sc.summary.prevDefectsPerThousandM),
    show(fig(quality, "kalite.binMetredeHata")?.deger, sc.summary.defectsPerThousandM));
  check("§R2d plan dışı onaylı metre = `PlanDeviationScorecard.summary.deviatedQtyM`", same(fig(quality, "kalite.planDisiMetre")?.deger, dev.summary.deviatedQtyM));
  // D1: eski Kalite Karnesi kumaş/renk/fason tabloları — yeni raporun üç görünümü hücre hücre aynı.
  const viewDrift: string[] = [];
  for (const [view, srcRows] of [["urun", qc.byItem], ["renk", qc.byColor], ["fasoncu", qc.bySubcontractor]] as const) {
    const vs = (await buildQualityReport({ range: RANGE, compareRange, compareMode: mode, filters: {}, view })).sunum;
    const vr = vs.tablo?.satirlar ?? [];
    if (vr.length !== srcRows.length) viewDrift.push(`${view} ${vr.length}/${srcRows.length}`);
    srcRows.forEach((s, i) => {
      const r = vr[i];
      if (!r || r.ad !== s.label || !same(r.top as number, s.rollCount) || !same(r.metre as number, s.totalQty) || !same(r.birinciMetre as number, s.topGradeQty)) viewDrift.push(`${view}:${s.label}`);
    });
  }
  check("§R2f ⭐ kalite görünümleri (kumaş · renk · fason) = eski Kalite Karnesi `byItem/byColor/bySubcontractor`",
    viewDrift.length === 0 && qc.byItem.length > 0, viewDrift.join(", ") || `kumaş ${qc.byItem.length} satır birebir`);
  const beamId = "00000000-0000-4000-8000-000000000097";
  const qBeam = (await buildQualityReport({ range: RANGE, compareRange, compareMode: mode, filters: { warpBeamId: beamId } })).sunum;
  const qcBeam = await getQualityScorecard(RANGE, compareRange, { warpBeamId: beamId });
  const scBeam = await getScrapScorecard(RANGE, compareRange, { warpBeamId: beamId });
  check("§R2e süzgeçli vaka (levent): pay ve 1000 m'de hata kaynağın AYNI süzgeçli değeri; plan dışı ölçülemedi",
    same(qBeam.anaSayi.deger, qcBeam.summary.topGrade && qcBeam.summary.totalQty > 0 ? qcBeam.summary.topGrade.pct : null)
      && same(fig(qBeam, "kalite.binMetredeHata")?.deger, scBeam.summary.defectsPerThousandM)
      && fig(qBeam, "kalite.planDisiMetre")?.deger === null && Boolean(fig(qBeam, "kalite.planDisiMetre")?.olculemedi),
    show(qBeam.anaSayi.deger, qcBeam.summary.topGrade?.pct));

  // §R3 Kayıp — üç kaynak, her biri kendi karnesinden; toplam oran yok
  const loss = (await buildLossReport({ range: RANGE, compareRange, compareMode: mode })).sunum;
  const { sources } = await collectLossSources(RANGE, compareRange);
  const sub = await getSubcontractScorecard(RANGE, compareRange);
  const src = (k: string) => sources.find((s) => s.key === k);
  check("§R3a hurda satırı = `ScrapScorecardSummary.scrapQty` (oran kendi paydası `producedQty`)",
    same(src("hurda")?.qty, sc.summary.scrapQty) && same(src("hurda")?.base, sc.summary.producedQty) && same(fig(loss, "fire.hurdaMetre")?.deger, sc.summary.scrapQty));
  check("§R3b ⭐ fason satırı = `SubcontractScorecard.summary.fireQty` — yalnız KAPANMIŞ kalem (fikstür 10 m, açık 270 m girmez)",
    same(src("fason")?.qty, sub.summary.fireQty) && same(src("fason")?.base, sub.summary.closedDispatchedQty) && same(fig(loss, "fire.fasonMetre")?.deger, sub.summary.fireQty)
      && sub.summary.openQty > 0,
    show(src("fason")?.qty, sub.summary.fireQty) + ` · açık ${sub.summary.openQty}`);
  const leventOpen = (await readDokumaEnabled()) && (await readDevereEnabled());
  if (leventOpen) {
    const beam = await beamResultReport({ from: RANGE.from.toISOString(), to: RANGE.to.toISOString() });
    check("§R3d levent satırı = `BeamResultSummary.fireM` / `beklenenM`", same(src("levent")?.qty, beam.data.ozet.fireM) && same(src("levent")?.base, beam.data.ozet.beklenenM));
  } else {
    check("§R3d levent kapalı: satır `null` + not (0 basılmaz)", src("levent")?.qty === null && Boolean(src("levent")?.note));
  }
  const expectedTotal = sources.map((s) => s.qty).filter((v): v is number => typeof v === "number").reduce((a, v) => a + v, 0);
  check("§R3c ⭐ ana sayı = ölçülen kaynakların toplamı (hurda + fason [+ levent])",
    same(loss.anaSayi.deger, Math.round((sc.summary.scrapQty + sub.summary.fireQty + (leventOpen ? (src("levent")?.qty ?? 0) : 0)) * 10) / 10)
      && same(loss.anaSayi.deger, Math.round(expectedTotal * 10) / 10),
    show(loss.anaSayi.deger, expectedTotal));
  const percentBlocks = [
    ...(loss.anaSayi.birim === "yuzde" ? ["ana sayı"] : []),
    ...loss.yanSayilar.filter((f) => f.birim === "yuzde" || !f.olcu.startsWith("fire.")).map((f) => `yan ${f.olcu}`),
    ...(loss.tablo?.toplam && loss.tablo.toplam.oran !== undefined && loss.tablo.toplam.oran !== null ? ["tablo toplamı"] : []),
    ...(loss.tablo?.satirlar.filter((r) => !["Hurda", "Fason farkı", "Levent farkı"].includes(String(r.kaynak))).map((r) => `tablo satırı ${String(r.kaynak)}`) ?? []),
    ...(loss.grafik?.eksen.y.birim === "yuzde" ? ["grafik"] : []),
  ];
  check("§R3e ⭐ TOPLAM FİRE ORANI hiçbir blokta yok (yan sayı · tablo toplamı · grafik)", percentBlocks.length === 0, percentBlocks.join(", ") || "yok");

  // §R4 Depo = stok karnesi (kesit)
  const depot = (await buildWarehouseReport()).sunum;
  const stock = await getStockScorecard();
  check("§R4a ana sayı = `StockScorecard.summary.deadQty`", same(depot.anaSayi.deger, stock.summary.deadQty), show(depot.anaSayi.deger, stock.summary.deadQty));
  check("§R4b yanlar = `finishedQty` · `agedQty` · `unagedQty`",
    same(fig(depot, "stok.bitmisMetre")?.deger, stock.summary.finishedQty) && same(fig(depot, "stok.eskiMetre")?.deger, stock.summary.agedQty)
      && same(fig(depot, "stok.yasiBilinmeyenMetre")?.deger, stock.summary.unagedQty));
  check("§R4c kesit kıyası ölçülemedi + ay sonu uyarısı (0'a çökmez)",
    depot.anaSayi.kiyas?.deger === null && depot.uyarilar.includes(NO_MONTH_END_SNAPSHOT));
  // D1: eski Stok & Ölü Stok kumaş tablosu = yeni depo tablosu (tavan altındaki satırlar hücre hücre).
  const depotRows = depot.tablo?.satirlar ?? [];
  const stockDrift = depotRows.filter((r, i) => {
    const s = stock.byItem[i];
    return !s || r.kumas !== s.label || !same(r.top as number, s.count) || !same(r.metre as number, s.qty) || !same(r.enEski as number | null, s.oldestDays) || !same(r.siparissiz as number, s.uncoveredQty);
  });
  check("§R4d ⭐ depo kumaş tablosu = eski Stok karnesi `byItem` (satır satır)",
    depotRows.length > 0 && depotRows.length === Math.min(stock.byItem.length, depotRows.length) && stockDrift.length === 0,
    `${depotRows.length}/${stock.byItem.length} satır · sapan ${stockDrift.length}`);

  // §R5 Fasoncular = fason karnesi (K-FASON)
  const subR = (await buildSubcontractorsReport({ range: RANGE, compareRange, compareMode: mode, filters: {} })).sunum;
  check("§R5a ⭐ ana sayı ortalama dönüş = `summary.avgTurnaroundDays` (+önceki `prevAvgTurnaroundDays`)",
    subR.anaSayi.olcu === "fason.ortalamaDonusGun" && same(subR.anaSayi.deger, sub.summary.avgTurnaroundDays) && same(subR.anaSayi.kiyas?.deger, sub.summary.prevAvgTurnaroundDays),
    show([subR.anaSayi.deger, subR.anaSayi.kiyas?.deger], [sub.summary.avgTurnaroundDays, sub.summary.prevAvgTurnaroundDays]));
  check("§R5b fikstür: dönüş 4 gün, önceki 10 gün", same(subR.anaSayi.deger, 4) && same(subR.anaSayi.kiyas?.deger, 10));
  check("§R5c yanlar = `openQty` (bekleyen) · `fireQty` (eksik dönen)",
    same(fig(subR, "fason.bekleyenMetre")?.deger, sub.summary.openQty) && same(fig(subR, "fire.fasonMetre")?.deger, sub.summary.fireQty) && subR.yanSayilar.length === 2);
  // D1: eski Fason Karnesi firma tablosu = yeni fasoncular tablosu (7 kolon hücre hücre).
  const subRows = subR.tablo?.satirlar ?? [];
  const subDrift = sub.bySubcontractor.filter((s, i) => {
    const r = subRows[i];
    return !r || r.fasoncu !== s.label || !same(r.gonderilen as number, s.dispatchedQty) || !same(r.donen as number, s.returnedQty) || !same(r.musteriye as number, s.deliveredQty)
      || !same(r.fark as number, s.fireQty) || !same(r.bekleyen as number, s.openQty) || !same(r.donusGun as number | null, s.avgTurnaroundDays);
  });
  check("§R5f ⭐ fasoncu tablosu = eski Fason Karnesi `bySubcontractor` (satır + 7 kolon)",
    subRows.length === sub.bySubcontractor.length && sub.bySubcontractor.length >= 2 && subDrift.length === 0,
    `${subRows.length}/${sub.bySubcontractor.length} · sapan ${subDrift.map((s) => s.label).join(", ") || "yok"}`);
  const subOne = (await buildSubcontractorsReport({ range: RANGE, compareRange, compareMode: mode, filters: { subcontractorId: [subId] } })).sunum;
  const subOneSrc = await getSubcontractScorecard(RANGE, compareRange, { subcontractorId: [subId] });
  check("§R5d süzgeçli vaka (fasoncu): ana + yanlar kaynağın AYNI süzgeçli değeri",
    same(subOne.anaSayi.deger, subOneSrc.summary.avgTurnaroundDays) && same(fig(subOne, "fason.bekleyenMetre")?.deger, subOneSrc.summary.openQty)
      && same(fig(subOne, "fire.fasonMetre")?.deger, subOneSrc.summary.fireQty) && subOneSrc.summary.openQty !== sub.summary.openQty,
    show(fig(subOne, "fason.bekleyenMetre")?.deger, subOneSrc.summary.openQty));

  // §V4 R1-VARYANT fasoncu kırılımı: hücre = AYNI süzgeçli karne (oran ölçüsü — toplam kuralı yok, oran yeniden hesaplanır)
  const subVar = (await runCoreWithExtras({ range: RANGE, compareRange, dims: SUBCONTRACTOR_DIMS, varyant: "fasoncu", run: subcontractorRunner({}, mode) })).sunum;
  const subCells = subVar.varyant?.hucreler ?? [];
  let subCellOk = subCells.length >= 1;
  for (const h of subCells) {
    const srcCell = await getSubcontractScorecard(RANGE, compareRange, { subcontractorId: [h.deger] });
    if (!same(h.anaSayi.deger, srcCell.summary.avgTurnaroundDays) || !same(h.anaSayi.kiyas?.deger, srcCell.summary.prevAvgTurnaroundDays)) subCellOk = false;
  }
  check("§V4 ⭐ fasoncu kırılımı: her hücre = `getSubcontractScorecard({subcontractorId:[hücre]})` ortalama dönüşü (+önceki)", subCellOk,
    subCells.map((h) => `${h.ad}=${h.anaSayi.deger}`).join(" · "));
}

// =============================================================================
// § Dokuma/finans (RAPC) — `dokuma/tezgah-randimani`, `dokuma/duruslar`, `dokuma/levent-dengesi`, `finance/alacaklar`
// =============================================================================
const RAPC_KEYS: ReportKey[] = ["dokuma/tezgah-randimani", "dokuma/duruslar", "dokuma/levent-dengesi", "finance/alacaklar"];
const RAPC_DAYS = { from: "2097-07-01", to: "2097-07-31" };
const rapcShiftDefs: string[] = [];

/** Ucun modül kapısı öneki (`require*Enabled`) — Express yığınından, gerçek fonksiyonlarla koşar. */
async function runModuleGates(path: string): Promise<{ gates: string[]; err: unknown }> {
  const layer = coreWeavingFinanceRouter.stack.find((l) => l.route?.path === path);
  const gates = (layer?.route?.stack ?? []).filter((h) => /^require\w*Enabled$/.test(h.name));
  for (const g of gates) {
    const err = await new Promise<unknown>((resolve) => {
      void Promise.resolve(Reflect.apply(g.handle, undefined, [{ headers: {}, query: {} }, {}, (e?: unknown) => resolve(e ?? null)]));
    });
    if (err) return { gates: gates.map((x) => x.name), err };
  }
  return { gates: gates.map((x) => x.name), err: null };
}
const moduleDisabled = (err: unknown): boolean =>
  (err as { statusCode?: number })?.statusCode === 403 && (err as { details?: { code?: string } })?.details?.code === "MODULE_DISABLED";

async function withFlags(flags: Record<string, boolean>, fn: () => Promise<void>): Promise<void> {
  const keys = Object.keys(flags);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  try {
    for (const [key, v] of Object.entries(flags)) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
    await fn();
  } finally {
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys.filter((k) => !before.some((b) => b.key === k)) } } });
    for (const b of before) await prisma.systemSetting.update({ where: { key: b.key }, data: { value: b.value as never } });
  }
}

async function rapcSection(): Promise<void> {
  console.log("\n── § Dokuma/finans (RAPC) ──");
  const permDrift = RAPC_KEYS.filter((k) => REPORT_BY_KEY.get(k)?.izin !== rapcPermissionOf(k));
  check("§C0a uç izni = katalog satırının `izin`i (dört uç)", permDrift.length === 0, permDrift.join(", ") || "birebir");

  // §C0b/c Modül kapısı kaynak raporunkiyle AYNI (dokuma · levent ayrıca devere · finans).
  const expectGates: Record<string, string[]> = {
    "/dokuma/tezgah-randimani": ["requireDokumaEnabled"],
    "/dokuma/duruslar": ["requireDokumaEnabled"],
    "/dokuma/levent-dengesi": ["requireDokumaEnabled", "requireDevereEnabled"],
    "/finance/alacaklar": ["requireFinanceEnabled"],
  };
  await withFlags({ "production.enabled": false, "dokuma.enabled": false, "devere.enabled": false, "finance.enabled": false }, async () => {
    for (const [path, gates] of Object.entries(expectGates)) {
      const r = await runModuleGates(path);
      check(`§C0b ${path} modül kapıları ${gates.join(" + ")}`, gates.every((g) => r.gates.includes(g)), r.gates.join(", ") || "kapı yok");
      check(`§C0c ⭐ ${path} modül kapalıyken 403 \`details.code\`=MODULE_DISABLED`, moduleDisabled(r.err), JSON.stringify((r.err as { details?: unknown })?.details ?? null));
    }
  });
  await withFlags({ "production.enabled": true, "dokuma.enabled": true, "devere.enabled": false }, async () => {
    const lev = await runModuleGates("/dokuma/levent-dengesi");
    const eff = await runModuleGates("/dokuma/tezgah-randimani");
    check("§C0d ⭐ dokuma açık + devere kapalı: levent 403 MODULE_DISABLED, randıman kapıdan geçer",
      moduleDisabled(lev.err) && eff.err === null, `levent ${JSON.stringify((lev.err as { details?: unknown })?.details ?? null)} · randıman ${eff.err ? "RED" : "geçti"}`);
  });

  const win = resolveCoreDayRange(RAPC_DAYS, 7);
  check("§C0e parametresiz kıyas = önceki dönem (gün aralığı; `kiyas` tel anahtarı)", win.mode === "prev" && win.compareDays?.to === "2097-06-30" && win.compareDays.from === "2097-05-31",
    JSON.stringify(win.compareDays));

  // §C1 Tezgah randımanı = Randıman toplamı + Kapasite özeti
  const eff = (await buildLoomEfficiencyReport({ window: win })).sunum;
  const effSrc = await efficiencyReport({ ...RAPC_DAYS, limit: 1 });
  const capSrc = await capacityUsageReport(RAPC_DAYS);
  check("§C1a ana sayı = `EfficiencyReport.toplam.effectivenessPct` (tek oran)", eff.anaSayi.olcu === "dokuma.randimanYuzde" && same(eff.anaSayi.deger, effSrc.toplam.effectivenessPct),
    show(eff.anaSayi.deger, effSrc.toplam.effectivenessPct));
  check("§C1b yanlar = kapasite `toplamGercekM` · `kullanimPct`",
    same(fig(eff, "dokuma.dokunanMetre")?.deger, capSrc.data.ozet.toplamGercekM) && same(fig(eff, "dokuma.kapasiteKullanimYuzde")?.deger, capSrc.data.ozet.kullanimPct));
  check("§C1c `kiyas` beyanı uygulanan kip + `kiyasDonemi`", eff.parametreler.find((p) => p.ad === "kiyas")?.deger === "prev" && eff.kiyasDonemi !== undefined);
  const reason = efficiencyReasonText(82.5, 91);
  check("§C1d \"neden\" açıklaması günlük dil (yasak sözcük yok, iki pay adıyla)", reason !== null && yasakSozcukBul(reason).length === 0 && /Çalışma payı/.test(reason) && /Hız payı/.test(reason), reason ?? "yok");

  // §C2 Duruşlar = Duruş Pareto + Müdahale
  const stops = (await buildLoomStopsReport({ window: win })).sunum;
  const par = await durusParetoReport(RAPC_DAYS);
  const alarm = await alarmResponseReport({ ...RAPC_DAYS, withPeople: false });
  check("§C2a ana sayı = `ParetoReport.toplam.stopSec` (dakika)", same(stops.anaSayi.deger, secondsToMinutes(par.toplam.stopSec)), show(stops.anaSayi.deger, par.toplam.stopSec));
  check("§C2b yanlar = `toplam.stopCount` · müdahale `ozet.ustlenmeOrtSn` (dakika)",
    same(fig(stops, "dokuma.durusSayisi")?.deger, par.toplam.stopCount) && same(fig(stops, "dokuma.mudahaleDakika")?.deger, secondsToMinutes(alarm.data.ozet.ustlenmeOrtSn)));
  // Fikstür vardiya tanımı (seed yazmaz) — süzgeç yolu kimliğiyle koşsun; cleanup siler.
  const fixtureDef = await prisma.shiftDefinition.create({ data: { code: `T${process.pid % 1_000_000}`, name: `${TAG} vardiya`, startMinute: 0, durationMinutes: 480 } });
  rapcShiftDefs.push(fixtureDef.id);
  const defs = await prisma.shiftDefinition.findMany({ select: { id: true } });
  {
    const allIds = defs.map((d) => d.id);
    const allPar = await durusParetoReport({ ...RAPC_DAYS, shiftDefinitionIds: allIds });
    const one = (await buildLoomStopsReport({ window: win, shiftDefinitionId: [allIds[0]] })).sunum;
    const oneSrc = await durusParetoReport({ ...RAPC_DAYS, shiftDefinitionIds: [allIds[0]] });
    check("§C2c vardiya süzgeci: tüm vardiyalar = süzgeçsiz; tek vardiya = kaynağın aynı süzgeçli değeri",
      same(allPar.toplam.stopSec, par.toplam.stopSec) && same(one.anaSayi.deger, secondsToMinutes(oneSrc.toplam.stopSec))
        && JSON.stringify(one.parametreler.find((p) => p.ad === "shiftDefinitionId")?.deger) === JSON.stringify([allIds[0]]));
  }
  let notFound = false;
  try { await buildLoomStopsReport({ window: win, shiftDefinitionId: ["00000000-0000-4000-8000-000000000000"] }); }
  catch (e) { notFound = (e as { statusCode?: number }).statusCode === 404; }
  check("§C2d bilinmeyen vardiya 404 (sessiz boş rapor yok)", notFound);
  check("§C2e en sık sebep = en çok tekrarlanan (süre değil)",
    mostFrequentReason({ ...par, sebepler: [{ reasonCode: "A", reasonLabel: "Uzun", lossClass: null, stopCount: 1, stopSec: 9000 }, { reasonCode: "B", reasonLabel: "Sık", lossClass: null, stopCount: 5, stopSec: 100 }] })?.reasonCode === "B");

  // §C3 Levent dengesi = Levent Sonucu (ölçülemeyen levent sıfıra çökmez)
  const synth = beamBalance([{ beklenenKumasM: 100, gercekKumasM: 90 }, { beklenenKumasM: null, gercekKumasM: 50 }]);
  check("§C3a ⭐ ölçülemeyen levent orana 0 metre olarak GİRMEZ (90/100 = %90; ayrı sayılır)", same(synth.balancePct, 90) && synth.unmeasured === 1 && same(synth.expectedM, 100),
    JSON.stringify(synth));
  check("§C3b hepsi ölçülemezse oran null (0 değil)", beamBalance([{ beklenenKumasM: null, gercekKumasM: 50 }]).balancePct === null);
  await withFlags({ "production.enabled": true, "dokuma.enabled": true, "devere.enabled": true }, async () => {
    const lev = (await buildBeamBalanceReport({ window: win })).sunum;
    const src = await beamResultReport(RAPC_DAYS);
    const bal = beamBalance(src.data.kapananlar);
    check("§C3c ana = Levent Sonucu satırlarından denge; beklenen = `ozet.beklenenM`; ölçülemeyen = `ozet.olculemedi`",
      same(lev.anaSayi.deger, bal.balancePct) && same(bal.expectedM, src.data.ozet.beklenenM) && same(fig(lev, "levent.olculemeyen")?.deger, src.data.ozet.olculemedi));
    check("§C3d boş dönemde ana sayı ölçülemedi (0'a çökmez)", src.data.kapananlar.length > 0 || (lev.anaSayi.deger === null && Boolean(lev.anaSayi.olculemedi)));
  });

  // §C4 Alacaklar = Cari Yaşlandırma + Çek Vade Takvimi (kesit)
  const asOf = new Date();
  const rec = (await buildReceivablesReport(asOf)).sunum;
  const aging = await getAgingReport({ asOf });
  const block = mainBlock(aging.blocks);
  check("§C4a ana sayı = ana bloğun `totals.overdueTotal`ı (yoksa ölçülemedi)",
    block ? same(rec.anaSayi.deger, Number(block.totals.overdueTotal)) : rec.anaSayi.deger === null && Boolean(rec.anaSayi.olculemedi), show(rec.anaSayi.deger, block?.totals.overdueTotal ?? null));
  if (block) {
    const due = (await chequeService.dueSummary()).data!;
    check("§C4b yan = 30 gün içinde vadesi gelecek ALINAN çek (`months[]`)", same(fig(rec, "cek.yaklasanVade")?.deger, Math.round(receivedChequesDue(due, block.currency) * 100) / 100));
    // R1-ZAMAN: kıyas = aynı yaşlandırmanın geçen ay sonu kesiti; o birimde blok yoksa ölçülemedi (0'a çökmez).
    const prev = (await getAgingReport({ asOf: factoryPreviousMonthEnd(asOf) })).blocks.find((b) => b.currency === block.currency);
    check("§C4c kıyas = geçen ay sonu kesitinin vadesi geçmişi (yoksa ölçülemedi + uyarı)",
      prev
        ? same(rec.anaSayi.kiyas?.deger, Number(prev.totals.overdueTotal)) && rec.uyarilar.includes(MONTH_END_REBUILT)
        : rec.anaSayi.kiyas?.deger === null && rec.uyarilar.includes(NO_MONTH_END_RECEIVABLES),
      show(rec.anaSayi.kiyas?.deger ?? null, prev?.totals.overdueTotal ?? null));
    check("§C4e kıyas dönemi geçen ay sonunun son anı", rec.kiyasDonemi?.to === factoryPreviousMonthEnd(asOf).toISOString());
  } else check("§C4c blok yokken ay sonu uyarısı basılmaz", !rec.uyarilar.includes(NO_MONTH_END_RECEIVABLES) && !rec.uyarilar.includes(MONTH_END_REBUILT));
  const fakeBlock = (currency: string) => ({ currency, totals: { overdueTotal: "1" } }) as unknown as Parameters<typeof mainBlock>[0][number];
  check("§C4d para birimleri toplanmaz: TL varsa TL, iki yabancı birimde ana sayı seçilmez",
    mainBlock([fakeBlock("USD"), fakeBlock("TRY")])?.currency === "TRY" && mainBlock([fakeBlock("USD"), fakeBlock("EUR")]) === null && mainBlock([fakeBlock("EUR")])?.currency === "EUR");

  const banned = [eff, stops, rec].flatMap((s) => yasakSozcukBul(JSON.stringify(s)).map((w) => `${s.anahtar}: ${w}`));
  check("§C5 sunum metinlerinde yasak sözcük yok", banned.length === 0, banned.join(", ") || "temiz");
}

// § GÖRÜNÜM (D2, 2026-11-12) — dokuma/finans raporlarının tablo seçimleri = eski raporun listesi hücre hücre.
// RAPC penceresinde (2097-07) tezgah verisi YOK → gerçek DB kıyası boş kümede ölçer (KÖR, beyan basılır);
// kolon eşlemesini sentetik satırla saf kurucu ölçer (§G*s).
async function viewSection(): Promise<void> {
  console.log("── §G tablo görünümleri (dokuma/finans) ──");
  const win = resolveCoreDayRange(RAPC_DAYS, 7);
  const blind = (what: string, n: number) => { if (n === 0) console.log(`   ⚠️ KÖR: ${what} bu fikstürde boş; eşlemeyi sentetik satır ölçer`); };

  const effAll = await efficiencyReport({ ...RAPC_DAYS, limit: SHIFT_STAT_PAGE_MAX });
  blind("vardiya satırları", effAll.satirlar.length);
  const effView = (await buildLoomEfficiencyReport({ window: win, view: "vardiyalar" })).sunum;
  cellsMatch("§G1a vardiyalar = Randıman `satirlar[]` (süreler dakika, K·P·E ayrı)", effView, effAll.satirlar.map((r) => ({
    tezgah: r.machine.code, vardiya: r.shift.name, planli: secondsToMinutes(r.potSec), calisti: secondsToMinutes(r.aptSec), durus: secondsToMinutes(r.durusSec),
    kullanilabilirlik: r.availabilityPct, performans: r.performancePct, randiman: r.effectivenessPct, atki: r.unitsActual, metre: r.producedM,
  })));
  check("§G1b ana sayı görünümle değişmez", same(effView.anaSayi.deger, (await buildLoomEfficiencyReport({ window: win })).sunum.anaSayi.deger));
  if (effAll.satirlar.length > 0) {
    const r0 = effAll.satirlar[0]!;
    const sc = await shiftScorecardReport({ factoryDay: r0.factoryDayKey.toISOString().slice(0, 10) });
    const m = sc.vardiyalar.find((v) => v.shiftInstanceId === r0.shiftInstanceId)?.makineler.find((x) => x.machineId === r0.machineId);
    check("§G1c duruş = Vardiya Karnesi makine satırının `durusSec`i", m !== undefined && m.durusSec === r0.durusSec, show(r0.durusSec, m?.durusSec));
  }
  const synthEff = {
    machineId: "m", machine: { code: "T-07", name: "Tezgah 7" }, shiftInstanceId: "s", factoryDayKey: new Date("2097-07-15T00:00:00.000Z"), shift: { code: "A", name: "Sabah" },
    live: false, sealState: "SEALED", source: "OPERATOR", emptyLoom: false, potSec: 28800, aptSec: 25200, unitsActual: 120000, producedM: 410.5, durusSec: 3600,
    targetUnitCapacityApt: 0, targetUnitCapacityPot: 0, targetUnitsPerMin: null, availabilityPct: 87.5, performancePct: 91.2, effectivenessPct: 79.8, olculemedi: {}, warnings: [],
  } satisfies EfficiencyRow;
  const sRow = shiftRowsTable([synthEff, { ...synthEff, emptyLoom: true, live: true }]).satirlar;
  check("§G1s sentetik: gün fabrika günü · 480/420/60 dk · K·P·E · kaynak · durum · boş tezgah",
    sRow[0]?.gun === "15.07.2097" && sRow[0]?.planli === 480 && sRow[0]?.calisti === 420 && sRow[0]?.durus === 60 && sRow[0]?.kullanilabilirlik === 87.5 && sRow[0]?.performans === 91.2 &&
      sRow[0]?.randiman === 79.8 && sRow[0]?.kaynak === "Operatör" && sRow[0]?.durum === "Mühürlü" && sRow[1]?.kaynak === "Boş tezgah" && sRow[1]?.durum === "Sürüyor",
    JSON.stringify(sRow[0]));

  const cap = await capacityUsageReport(RAPC_DAYS);
  blind("kapasite satırları", cap.data.satirlar.length);
  cellsMatch("§G1d kapasite ayrıntısı = Kapasite Kullanımı `satirlar[]` (10 kolon)", (await buildLoomEfficiencyReport({ window: win, view: "kapasite" })).sunum, cap.data.satirlar.map((r) => ({
    tezgah: r.code, hafta: r.hafta, nominal: r.nominalUnitsPerMin, atkiCm: r.unitsPerCm, teorik: r.teorikMSaat, takvim: r.takvimSaat, potansiyel: r.potansiyelM, gercek: r.gercekM, kullanim: r.kullanimPct, hesaplanamadi: r.hesaplanamadi,
  })));
  const cRow = capacityDetailTable([{ machineId: "m", code: "T-07", name: "x", hafta: "2097-W29", haftaBaslangic: "2097-07-13", nominalUnitsPerMin: 600, unitsPerCm: 30, teorikMSaat: 12, takvimSaat: 168, potansiyelM: 2016, gercekM: 1500, kullanimPct: 74.4, hesaplanamadi: null }]).satirlar[0];
  check("§G1ds sentetik kapasite: her kolon kendi alanı", cRow?.nominal === 600 && cRow.atkiCm === 30 && cRow.teorik === 12 && cRow.takvim === 168 && cRow.potansiyel === 2016 && cRow.gercek === 1500 && cRow.kullanim === 74.4, JSON.stringify(cRow));

  const alarm = await alarmResponseReport({ ...RAPC_DAYS, withPeople: false });
  const resp = (rows: AlarmResponseRow[]) => rows.map((r) => ({ ad: r.etiket, alarm: r.alarm, ustlenme: secondsToMinutes(r.ustlenmeOrtSn), cozum: secondsToMinutes(r.cozumOrtSn), asim: r.asimOraniPct }));
  const axes = { mudahaleSebep: alarm.data.sebepler, mudahaleHol: alarm.data.holler, mudahaleTezgah: alarm.data.tezgahlar, mudahaleVardiya: alarm.data.vardiyalar } as const;
  check("§G2a görünüm kümesi = Müdahale eksenleri (kişi hariç)", JSON.stringify(LOOM_STOP_VIEWS.slice(1)) === JSON.stringify(Object.keys(axes)), LOOM_STOP_VIEWS.join(","));
  for (const [view, rows] of Object.entries(axes) as Array<[keyof typeof axes, AlarmResponseRow[]]>) {
    blind(`müdahale ${view}`, rows.length);
    cellsMatch(`§G2b ${view} = Müdahale satırları (üstlenme/çözüm dakika, aşım %)`, (await buildLoomStopsReport({ window: win, view })).sunum, resp(rows));
  }
  const tag = (etiket: string) => [{ anahtar: etiket, etiket } as AlarmResponseRow];
  const fakeAlarm = { sebepler: tag("sebep"), holler: tag("hol"), tezgahlar: tag("tezgah"), vardiyalar: tag("vardiya"), kisiler: tag("kisi") } as unknown as Parameters<typeof responseRowsOf>[1];
  const mapped = (["mudahaleSebep", "mudahaleHol", "mudahaleTezgah", "mudahaleVardiya"] as const).map((v) => `${responseRowsOf(v, fakeAlarm).first}:${responseRowsOf(v, fakeAlarm).rows[0]?.etiket}`);
  check("§G2t sentetik: her görünüm kendi Müdahale ekseni (kişi yok)", mapped.join(",") === "Alarm türü:sebep,Hol:hol,Tezgah:tezgah,Vardiya:vardiya", mapped.join(","));
  const rRow = responseTable("Tezgah", [{ anahtar: "k", etiket: "T-07", alarm: 4, ustlenmeOrtSn: 90, cozumOrtSn: 600, asimOraniPct: 25 } as AlarmResponseRow]).satirlar[0];
  check("§G2s sentetik müdahale: 90 sn → 1,5 dk · 600 sn → 10 dk · aşım %25", rRow?.ad === "T-07" && rRow.alarm === 4 && rRow.ustlenme === 1.5 && rRow.cozum === 10 && rRow.asim === 25, JSON.stringify(rRow));

  const beam = (over: Partial<BeamResultRow>): BeamResultRow => ({
    beamId: "b", beamNo: "L-12", physicalBeamNo: "F3", warpSpec: { id: "w", code: "CZ-1", name: "Tül", takeUpPct: null }, sarilanM: 1000, sarilanKg: null,
    kgKaynak: {} as BeamResultRow["kgKaynak"], beklenenKumasM: 950, gercekKumasM: 930, gercekKaynak: { otomatik: 900, elle: 30 }, kalanM: 0, fireM: 20, firePct: 2.1,
    status: "FINISHED" as BeamResultRow["status"], kapanisAt: new Date("2097-07-20T09:00:00.000Z"), tezgahlar: ["T-07", "T-08"], ...over,
  });
  const kRow = closedBeamDetailTable([beam({})]).satirlar[0];
  check("§G3s sentetik biten levent: etiket · tezgah · otomatik/elle ayrı · fire · kapanış fabrika günü",
    kRow?.levent === "L-12 (F3)" && kRow.tezgah === "T-07, T-08" && kRow.otomatik === 900 && kRow.elle === 30 && kRow.fire === 20 && kRow.firePct === 2.1 && kRow.kapanis === factoryDateTr(new Date("2097-07-20T09:00:00.000Z")),
    JSON.stringify(kRow));
  const oRow = openBeamTable([beam({ kalanM: 400, kullanimPct: 60, tezgahlar: [] })]).satirlar[0];
  check("§G3t sentetik açık levent: kalan · kullanım · tezgahsız null", oRow?.kalan === 400 && oRow.kullanim === 60 && oRow.tezgah === null, JSON.stringify(oRow));
  await withFlags({ "production.enabled": true, "dokuma.enabled": true, "devere.enabled": true }, async () => {
    const src = await beamResultReport(RAPC_DAYS);
    blind("biten levent", src.data.kapananlar.length);
    blind("açık levent", src.data.acikLeventler.length);
    cellsMatch("§G3a biten levent ayrıntısı = Levent Sonucu `kapananlar[]`", (await buildBeamBalanceReport({ window: win, view: "kapananlar" })).sunum, src.data.kapananlar.map((r) => ({
      sarilan: r.sarilanM, dokunan: r.gercekKumasM, otomatik: r.gercekKaynak.otomatik, elle: r.gercekKaynak.elle, beklenen: r.beklenenKumasM, fire: r.fireM, firePct: r.firePct,
    })));
    cellsMatch("§G3b tezgahtaki leventler = Levent Sonucu `acikLeventler[]`", (await buildBeamBalanceReport({ window: win, view: "acik" })).sunum,
      src.data.acikLeventler.map((r) => ({ sarilan: r.sarilanM, kalan: r.kalanM, dokunan: r.gercekKumasM, kullanim: r.kullanimPct ?? null })));
  });

  const asOf = new Date();
  const aging = await getAgingReport({ asOf });
  const open = aging.blocks.flatMap((b) => b.rows.map((r) => ({ b, r }))).filter(({ r }) => Number(r.openTotal) !== 0);
  blind("açık alacak", open.length);
  cellsMatch("§G4a cari × vade = Yaşlandırma `rows[].net[kova]` (birim kendi satırında)", (await buildReceivablesReport(asOf, "kovalar")).sunum, open.map(({ b, r }) => ({
    paraBirimi: b.currency, ...Object.fromEntries(aging.buckets.map((k) => [`kova_${k.key}`, Number(r.net[k.key])])), acik: Number(r.openTotal),
  })));
  const fakeAging = {
    buckets: [{ key: "current", label: "Vadesi gelmemiş" }, { key: "d1_30", label: "1-30" }],
    blocks: [
      { currency: "TRY", rows: [{ code: "C1", name: "Kaya", openTotal: "150", net: { current: "100", d1_30: "50" } }, { code: "", name: "Sıfır", openTotal: "0", net: { current: "0", d1_30: "0" } }] },
      { currency: "USD", rows: [{ code: "C2", name: "Acme", openTotal: "70", net: { current: "0", d1_30: "70" } }] },
    ],
  } as unknown as Parameters<typeof agingBucketTable>[0];
  const ag = agingBucketTable(fakeAging).satirlar;
  check("§G4s sentetik: sıfır açık satır düşer · para birimleri toplanmaz · kova = net",
    ag.length === 2 && ag[0]?.cari === "C1 · Kaya" && ag[0]?.kova_current === 100 && ag[0]?.kova_d1_30 === 50 && ag[1]?.paraBirimi === "USD" && ag[1]?.acik === 70, JSON.stringify(ag));
}

async function cleanup(): Promise<void> {
  if (rapcShiftDefs.length) await prisma.shiftDefinition.deleteMany({ where: { id: { in: rapcShiftDefs } } });
  if (ids.receiptItems.length) await prisma.subcontractorReceiptItem.deleteMany({ where: { id: { in: ids.receiptItems } } });
  if (ids.receipts.length) await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
  if (ids.dispatchItems.length) await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
  if (ids.dispatches.length) await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
  if (ids.rolls.length) {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: ids.rolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  }
  if (ids.batches.length) await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } });
  if (ids.steps.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } });
  if (ids.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
  if (ids.subs.length) await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
}

// ─── § Satış (RAPA) fikstürü ve bölümü ───────────────────────────────────────
const SALES_TAG = `${TAG}-S`;
const SALES_RANGE = { from: new Date("2097-03-01T00:00:00.000Z"), to: new Date("2097-03-31T23:59:59.999Z") };
const SALES_PREV = { from: new Date("2097-02-01T00:00:00.000Z"), to: new Date("2097-02-28T23:59:59.999Z") };
const SALES_EMPTY = { from: new Date("2096-06-01T00:00:00.000Z"), to: new Date("2096-06-30T23:59:59.999Z") };
const salesDay = (s: string) => new Date(`${s}T09:00:00.000Z`);

const salesIds = { customers: [] as string[], orders: [] as string[], shipments: [] as string[], sacks: [] as string[], rolls: [] as string[], returns: [] as string[] };
let salesItemId = "";
let salesColorId = "";

async function customer(n: string, d: ShipmentDestination): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${SALES_TAG}-${n}`, name: `${SALES_TAG} ${n}`, defaultDestination: d, country: d === "EXPORT" ? "Almanya" : null }, select: { id: true },
  });
  salesIds.customers.push(c.id);
  return c.id;
}
interface OrderOpts { orderDate: string; currency?: Currency; unitPrice?: number | null; deadline?: string; status?: "APPROVED" | "COMPLETED" | "CANCELLED"; completedAt?: string; cancelledAt?: string; shippedQty?: number }
async function order(customerId: string, qty: number, o: OrderOpts): Promise<string> {
  const destination = (await resolveShipmentDestination(prisma, { customerId })).destination;
  const r = await prisma.order.create({
    data: {
      orderNumber: `${SALES_TAG}-O${salesIds.orders.length}`, customerId, destination, currency: o.currency ?? "TRY", orderDate: salesDay(o.orderDate),
      status: o.status ?? "APPROVED", deadline: o.deadline ? salesDay(o.deadline) : null, completedAt: o.completedAt ? salesDay(o.completedAt) : null,
      cancelledAt: o.cancelledAt ? salesDay(o.cancelledAt) : null,
      lines: { create: [{ itemId: salesItemId, quantity: qty, unitPrice: o.unitPrice ?? null, shippedQty: o.shippedQty ?? 0 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  salesIds.orders.push(r.id);
  return r.lines[0]!.id;
}
async function ship(customerId: string, destination: ShipmentDestination, day: string, meters: number, lineId: string, allocQty: number): Promise<string> {
  const sh = await prisma.shipment.create({ data: { shipmentNo: `${SALES_TAG}-S${salesIds.shipments.length}`, customerId, status: "DISPATCHED", destination, dispatchedAt: salesDay(day) }, select: { id: true } });
  salesIds.shipments.push(sh.id);
  const k = await prisma.sack.create({ data: { sackNo: `${SALES_TAG}-K${salesIds.sacks.length}`, customerId, shipmentId: sh.id }, select: { id: true } });
  salesIds.sacks.push(k.id);
  const r = await prisma.roll.create({ data: { barcode: `${SALES_TAG}-R${salesIds.rolls.length}`, itemId: salesItemId, initialQty: meters, currentQty: meters, status: "SHIPPED", sackId: k.id, shipmentId: sh.id }, select: { id: true } });
  salesIds.rolls.push(r.id);
  await prisma.sackAllocation.create({ data: { sackId: k.id, orderLineId: lineId, qty: allocQty } });
  return sh.id;
}

async function salesSetup(): Promise<{ cD: string; cE: string }> {
  const item = await prisma.item.create({ data: { code: `${SALES_TAG}-I`, name: `${SALES_TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  salesItemId = item.id;
  const cD = await customer("CD", "DOMESTIC");
  const cE = await customer("CE", "EXPORT");
  // Mart: zamanında (yurtiçi) · geç (yurtdışı) · terminsiz · dönemde alınıp iptal · açık (termini geçmiş)
  const lD1 = await order(cD, 100, { orderDate: "2097-03-02", unitPrice: 10, deadline: "2097-03-10", status: "COMPLETED", completedAt: "2097-03-08", shippedQty: 100 });
  const lE1 = await order(cE, 200, { orderDate: "2097-03-02", currency: "USD", unitPrice: 5, deadline: "2097-03-05", status: "COMPLETED", completedAt: "2097-03-09", shippedQty: 200 });
  // Talep görünümü (§S1v): aynı siparişe renkli + enli ikinci kalem — kumaş+renk+en çeşidi ve renk kırılımı ayrışsın.
  salesColorId = (await prisma.color.create({ data: { code: `${SALES_TAG}-C`, name: `${SALES_TAG} RENK` }, select: { id: true } })).id;
  const e1Order = (await prisma.orderLine.findUniqueOrThrow({ where: { id: lE1 }, select: { orderId: true } })).orderId;
  await prisma.orderLine.create({ data: { orderId: e1Order, itemId: salesItemId, colorId: salesColorId, width: 280, quantity: 70, unitPrice: 5, shippedQty: 70 } });
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
  const rr = await prisma.roll.create({ data: { barcode: `${SALES_TAG}-RR`, itemId: salesItemId, initialQty: 10, currentQty: 10, status: "WAREHOUSE" }, select: { id: true } });
  salesIds.rolls.push(rr.id);
  const ret = await prisma.rollReturn.create({ data: { rollId: rr.id, customerId: cE, itemId: salesItemId, qty: 10, receivedById: admin.id, fromShipmentId: sE, createdAt: salesDay("2097-03-20") }, select: { id: true } });
  salesIds.returns.push(ret.id);
  const wh = await prisma.roll.create({ data: { barcode: `${SALES_TAG}-RW`, itemId: salesItemId, initialQty: 30, currentQty: 30, status: "WAREHOUSE" }, select: { id: true } });
  salesIds.rolls.push(wh.id);
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
    const src = await getOrderIntake(SALES_RANGE, SALES_PREV, {});
    const { sunum: s } = await buildOrderDemandReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} });
    shape("S1z", s);
    check("S1a ana sayı = summary.totalQty", s.anaSayi.deger === src.summary.totalQty, `${s.anaSayi.deger} / ${src.summary.totalQty}`);
    check("S1b kıyas = summary.prevTotalQty", s.anaSayi.kiyas?.deger === src.summary.prevTotalQty, `${s.anaSayi.kiyas?.deger} / ${src.summary.prevTotalQty}`);
    check("S1c yan: sipariş adedi = activeOrderCount · müşteri = customerCount",
      side(s, "siparis.aktifAdet")?.deger === src.summary.activeOrderCount && side(s, "siparis.musteriSayisi")?.deger === src.summary.customerCount,
      `${side(s, "siparis.aktifAdet")?.deger}/${src.summary.activeOrderCount} · ${side(s, "siparis.musteriSayisi")?.deger}/${src.summary.customerCount}`);
    check("S1d çok para birimi → tutar ÖLÇÜLEMEDİ (null, 0 değil)", src.summary.amounts.length > 1 && side(s, "siparis.tutar")?.deger === null,
      JSON.stringify(src.summary.amounts));
    const srcF = await getOrderIntake(SALES_RANGE, null, { customerId: [cD] });
    const { sunum: f } = await buildOrderDemandReport({ range: SALES_RANGE, compareRange: null, compareMode: "none", filters: { customerId: [cD] } });
    const amt = side(f, "siparis.tutar");
    check("S1e süzgeçli (müşteri): ana = totalQty · tutar = amounts[0] (TRY)",
      f.anaSayi.deger === srcF.summary.totalQty && srcF.summary.amounts.length === 1 && amt?.deger === srcF.summary.amounts[0]!.amount && amt?.birim === "TRY",
      `${f.anaSayi.deger}/${srcF.summary.totalQty} · ${amt?.deger} ${amt?.birim} / ${JSON.stringify(srcF.summary.amounts)}`);
    check("S1f fiyatsız satır tutara 0 diye girmez (sayısı ayrı)", srcF.summary.unpricedLineCount === 1 && srcF.summary.pricedLineCount === 2,
      `fiyatlı ${srcF.summary.pricedLineCount} · fiyatsız ${srcF.summary.unpricedLineCount}`);
  }

  console.log("── S2 sevkiyat (BRÜT `_shipped`) ──");
  {
    const sc = await getShipmentScorecard(SALES_RANGE, null, {});
    const scPrev = await getShipmentScorecard(SALES_PREV, null, {});
    const mix = await getDestinationMix(SALES_RANGE, null);
    const { sunum: s } = await buildShippedReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} });
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
    const scE = await getShipmentScorecard(SALES_RANGE, null, { destination: "EXPORT" });
    const { sunum: f } = await buildShippedReport({ range: SALES_RANGE, compareRange: null, compareMode: "none", filters: { destination: "EXPORT" } });
    const usd = exp.money.amounts.find((a) => a.currency === "USD");
    check("S2e süzgeçli (yön EXPORT): ana = shippedQty · tutar = EXPORT USD · ihracat payı gösterilmez",
      f.anaSayi.deger === scE.summary.shippedQty && side(f, "sevk.tutar")?.deger === usd?.amount && side(f, "sevk.tutar")?.birim === "USD" && !side(f, "sevk.ihracatPayi"),
      `${f.anaSayi.deger}/${scE.summary.shippedQty} · ${side(f, "sevk.tutar")?.deger}/${usd?.amount}`);
  }

  console.log("── S3 termin (zamanında teslim + teslim süresi) ──");
  {
    const sc = await getShipmentScorecard(SALES_RANGE, null, {});
    const scPrev = await getShipmentScorecard(SALES_PREV, null, {});
    const lt = await getOrderLeadTime(SALES_RANGE, {});
    const { sunum: s } = await buildDeadlineReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} });
    shape("S3z", s);
    check("S3a ⭐ ana sayı = `onTimePct` (terminsiz paydada YOK)", sc.summary.withDeadlineOrders > 0 && s.anaSayi.deger === sc.summary.onTimePct && sc.summary.noDeadlineOrders > 0,
      `${s.anaSayi.deger} / ${sc.summary.onTimePct} · terminli ${sc.summary.withDeadlineOrders} · terminsiz ${sc.summary.noDeadlineOrders}`);
    check("S3b kıyas = önceki dönem onTimePct", s.anaSayi.kiyas?.deger === scPrev.summary.onTimePct, `${s.anaSayi.kiyas?.deger} / ${scPrev.summary.onTimePct}`);
    check("S3c geç kalan = withDeadline − onTime", side(s, "termin.gecikenSiparis")?.deger === sc.summary.withDeadlineOrders - sc.summary.onTimeOrders);
    const med = side(s, "termin.yariSureGun");
    check("S3d teslim süresi = fullClose.medianDays (az örnekte ölçülemedi)",
      lt.fullClose.sampleSize < MIN_SAMPLE ? med?.deger === null && !!med?.olculemedi : med?.deger === lt.fullClose.medianDays,
      `${med?.deger} / n=${lt.fullClose.sampleSize} medyan ${lt.fullClose.medianDays}`);
    const scE = await getShipmentScorecard(SALES_RANGE, null, { destination: "EXPORT" });
    const { sunum: f } = await buildDeadlineReport({ range: SALES_RANGE, compareRange: null, compareMode: "none", filters: { destination: "EXPORT" } });
    check("S3e süzgeçli (yön EXPORT): ana = onTimePct ve GERÇEK 0 sıfır kalır", scE.summary.withDeadlineOrders > 0 && f.anaSayi.deger === scE.summary.onTimePct && f.anaSayi.deger === 0,
      `${f.anaSayi.deger} / ${scE.summary.onTimePct}`);
    const scEmpty = await getShipmentScorecard(SALES_EMPTY, null, {});
    const { sunum: e } = await buildDeadlineReport({ range: SALES_EMPTY, compareRange: null, compareMode: "none", filters: {} });
    check("S3f terminli sipariş yok → ölçülemedi (kaynak 0 verir, temel null)", scEmpty.summary.withDeadlineOrders === 0 && e.anaSayi.deger === null && !!e.anaSayi.olculemedi,
      `${e.anaSayi.deger} / kaynak ${scEmpty.summary.onTimePct}`);
  }

  console.log("── S4 açık siparişler (kesit) ──");
  {
    const src = await getOpenOrderCoverage({ itemId: [salesItemId] });
    const { sunum: s, suzgec } = await buildOpenOrderReport({ filters: { itemId: [salesItemId] } });
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
    const ret = await getReturnScorecard(SALES_RANGE, SALES_PREV);
    const can = await getOrderCancellationScorecard(SALES_RANGE);
    const canPrev = await getOrderCancellationScorecard(SALES_PREV);
    const { sunum: s } = await buildLostWorkReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev" });
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

  console.log("── S5v vazgeçilen iş tablo görünümleri = İptal / İade Karnesi listeleri ──");
  {
    const ret = await getReturnScorecard(SALES_RANGE, SALES_PREV);
    const can = await getOrderCancellationScorecard(SALES_RANGE);
    const run = async (view: LostWorkView) => (await buildLostWorkReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", view })).sunum;
    const iptaller = await run("iptaller");
    const decl = viewDecl(iptaller);
    check("S5v0 `gorunum` beyanı: uygulanan değer + seçenekler = LOST_WORK_VIEWS; ana sayı görünümle değişmez",
      decl?.deger === "iptaller" && JSON.stringify(decl.secenekler?.map((o) => o.deger)) === JSON.stringify(LOST_WORK_VIEWS) && iptaller.anaSayi.deger === 80);
    cellsMatch("S5v1 ⭐ iptaller = `orders[]` (sipariş · müşteri · iptal günü · metre · sevk · gün · sebep)", iptaller, can.orders.map((o) => ({
      siparis: o.orderNumber, musteri: o.customerName, iptalGunu: factoryDateTr(new Date(o.cancelledAt)), metre: o.qty, sevkEdilen: o.shippedQty, gun: o.daysToCancel, sebep: o.reasonLabel ?? "Sebep girilmemiş",
    })), true);
    cellsMatch("S5v2 iptal sebepleri = `byReason[]`", await run("iptalSebep"), can.byReason.map((r) => ({ sebep: r.label, adet: r.count, metre: r.qty, pay: r.sharePct })), true);
    cellsMatch("S5v3 iptal müşteri = `byCustomer[]` (oran + en sık sebep)", await run("iptalMusteri"),
      can.byCustomer.map((r) => ({ musteri: r.customerName, adet: r.count, metre: r.qty, oran: r.cancelRatePct, sebep: r.topReasonLabel })), true);
    const iade = (rows: typeof ret.byCustomer) => rows.map((r) => ({ ad: r.label, top: r.count, metre: r.qty, onceki: r.prevQty ?? null }));
    cellsMatch("S5v4 iade müşteri = `byCustomer[]` (önceki dönem kolonu dahil)", await run("iadeMusteri"), iade(ret.byCustomer), true);
    cellsMatch("S5v5 iade kumaş = `byItem[]`", await run("iadeKumas"), iade(ret.byItem), true);
    cellsMatch("S5v6 iade renk = `byColor[]`", await run("iadeRenk"), iade(ret.byColor));
    cellsMatch("S5v7 iade sebep = `byReason[]`", await run("iadeSebep"), iade(ret.byReason));
  }

  console.log("── S1v sipariş-talep tablo görünümleri = Talep Analizi listeleri ──");
  {
    const da = await getDemandAnalysis(SALES_RANGE, SALES_PREV, {});
    const run = async (view: OrderDemandView, filters: OrderDemandFilters = {}) =>
      (await buildOrderDemandReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters, view })).sunum;
    const cesit = await run("cesit");
    const decl = viewDecl(cesit);
    const base = (await buildOrderDemandReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} })).sunum;
    check("S1v0 `gorunum` beyanı = ORDER_DEMAND_VIEWS · ana sayı görünümle değişmez",
      decl?.deger === "cesit" && JSON.stringify(decl.secenekler?.map((o) => o.deger)) === JSON.stringify(ORDER_DEMAND_VIEWS) && cesit.anaSayi.deger === base.anaSayi.deger && viewDecl(base)?.deger === "ozet");
    cellsMatch("S1v1 ⭐ kumaş + renk + en = `specs[]` (renk · en · kalem · müşteri · metre · pay · önceki)", cesit, da.specs.map((r) => ({
      kumas: r.itemName, renk: r.colorName ?? "Renk belirtilmemiş", en: r.width, kalem: r.lineCount, musteri: r.customerCount, metre: r.qty, pay: r.sharePct, onceki: r.prevQty ?? null,
    })), true);
    check("S1v2 çeşit toplamı: kalem = lineCount · metre = totalQty · çekirdek çeşit sayısı etikette",
      cesit.tablo?.toplam?.kalem === da.summary.lineCount && cesit.tablo?.toplam?.metre === da.summary.totalQty && da.specs.length === 2
        && String(cesit.tablo?.toplam?.kumas).includes(`${da.summary.specCount} çeşit`) && String(cesit.tablo?.toplam?.kumas).includes(`ilk ${da.summary.coreSpecCount} çeşitte`),
      JSON.stringify(cesit.tablo?.toplam));
    const bd = (rows: typeof da.byItem) => rows.map((r) => ({ ad: r.label, kalem: r.count, metre: r.qty, onceki: r.prevQty ?? null }));
    cellsMatch("S1v3 kumaş = `byItem[]`", await run("kumas"), bd(da.byItem), true);
    const renk = await run("renk");
    cellsMatch("S1v4 renk = `byColor[]` (renksiz talep kendi satırında)", renk, bd(da.byColor), true);
    check("S1v4b renksiz talep satırı = summary.colorlessQty", renk.tablo?.satirlar.find((r) => r.ad === "Renk belirtilmemiş")?.metre === da.summary.colorlessQty && da.summary.colorlessQty > 0);
    const aylik = await run("aylik");
    cellsMatch("S1v5 aylık = `monthly[]` (son 24 ay)", aylik, da.monthly.map((m) => ({ ay: m.month, kalem: m.lineCount, metre: m.qty })));
    check("S1v5b aylık görünüm dönemden bağımsız olduğunu uyarıda söyler", aylik.uyarilar.some((u) => u.includes("son 24 ay")));
    const daF = await getDemandAnalysis(SALES_RANGE, SALES_PREV, { destination: "EXPORT" });
    cellsMatch("S1v6 süzgeçli (yön EXPORT) = aynı süzgeçli Talep Analizi", await run("cesit", { destination: "EXPORT" }), daF.specs.map((r) => ({ kumas: r.itemName, renk: r.colorName ?? "Renk belirtilmemiş", metre: r.qty })), true);
  }

  console.log("── S1p sipariş-talep müşteri profili görünümü = Müşteri Sipariş Profili ──");
  {
    const want = (rows: Awaited<ReturnType<typeof getCustomerOrderProfiles>>["rows"]) => rows.map((r) => ({
      musteri: r.customerName, kod: r.customerCode, siparis: r.orderCount, kalem: r.lineCount, kumas: r.topItemName, renk: r.topColorName, en: r.topWidth,
      sonSiparis: r.lastOrderDate ? factoryDateTr(new Date(r.lastOrderDate)) : null,
    }));
    const run = async (filters: OrderDemandFilters = {}) =>
      (await buildOrderDemandReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters, view: "musteriProfili" })).sunum;
    const all = await run();
    cellsMatch("S1p1 ⭐ profil = `getCustomerOrderProfiles()` satırları (en sık kumaş/renk/en · kalem · son sipariş)", all, want((await getCustomerOrderProfiles({})).rows), true);
    const one = await run({ customerId: [cD] });
    const src = (await getCustomerOrderProfiles({ customerId: [cD] })).rows;
    cellsMatch("S1p2 süzgeçli (müşteri) = aynı süzgeçli profil", one, want(src), true);
    check("S1p3 fikstür müşterisi: sipariş 5 · son sipariş Mart · görünüm tüm zamanlar uyarısı",
      src.length === 1 && src[0]!.orderCount === 5 && one.tablo?.satirlar[0]?.sonSiparis === factoryDateTr(salesDay("2097-03-04")) && one.uyarilar.some((u) => u.includes("dönemden bağımsız")),
      JSON.stringify(one.tablo?.satirlar[0]));
    let code: unknown = null;
    try { await run({ destination: "EXPORT" }); } catch (e) { code = (e as { statusCode?: number; details?: { code?: string } }).details?.code; }
    check("S1p4 yön/kumaş süzgeciyle profil görünümü 400 VIEW_FILTER_UNSUPPORTED (müşteri kartı yönü ≠ sipariş yönü)", code === "VIEW_FILTER_UNSUPPORTED", String(code));
  }

  console.log("── S6 K-KIYAS: parametresiz çağrı = önceki dönem ──");
  {
    const { mode, compareRange } = resolveCoreCompare({}, SALES_RANGE);
    const ref = resolveCompareRange({ compare: "prev" }, SALES_RANGE)!;
    check("S6a `kiyas` yok → kip prev, aralık = resolveCompareRange(prev)", mode === "prev" && compareRange?.from.getTime() === ref.from.getTime() && compareRange?.to.getTime() === ref.to.getTime());
    const src = await getOrderIntake(SALES_RANGE, compareRange, {});
    const { sunum: s } = await buildOrderDemandReport({ range: SALES_RANGE, compareRange, compareMode: mode, filters: {} });
    const k = s.parametreler.find((p) => p.ad === "kiyas");
    check("S6b zarf: `kiyas` beyanı = prev · kiyasDonemi dolu · kıyas = prevTotalQty",
      k?.deger === "prev" && (k.secenekler?.length ?? 0) === 4 && !!s.kiyasDonemi && s.anaSayi.kiyas?.deger === src.summary.prevTotalQty,
      `${k?.deger} · ${s.kiyasDonemi?.etiket} · ${s.anaSayi.kiyas?.deger}`);
    const none = resolveCoreCompare({ kiyas: "none" }, SALES_RANGE);
    check("S6c açık `none` → kıyas yok", none.mode === "none" && none.compareRange === null);
  }

  console.log("── S7 iki iptal tanımı (aynı fikstür) ──");
  {
    const intake = await getOrderIntake(SALES_RANGE, null, {});
    const can = await getOrderCancellationScorecard(SALES_RANGE);
    console.log(`   Sipariş Karnesi cancelledPct (dönemde ALINAN siparişlerden iptal olan, çıpa sipariş tarihi): %${intake.summary.cancelledPct} (${intake.summary.cancelledCount}/${intake.summary.orderCount})`);
    console.log(`   İptal Karnesi cancelRatePct (dönemde İPTAL edilen ÷ dönemde açılan, çıpa iptal anı): %${can.summary.cancelRatePct} (${can.summary.cancelledCount}/${can.summary.openedInPeriod})`);
    check("S7a iki tanım bu fikstürde FARKLI (Ocak'ta alınıp Mart'ta iptal) — temel rapor yalnız ikincisini kullanır",
      intake.summary.cancelledPct === 20 && can.summary.cancelRatePct === 40, `${intake.summary.cancelledPct} ≠ ${can.summary.cancelRatePct}`);
  }
}

// § R1-VARYANT (gerçek DB, satış fikstürü): küçük çoklu hücresi = o değerle SÜZÜLMÜŞ kaynak karne; hücre toplamı ≤ ana sayı
// (metre toplanır; oran ölçüsünde toplam kuralı yok); dönem kıyasının son sütunu = o dönemin TEK koşusu.
// NEGATİF SONDA (2026-10-25, md5 ile geri alındı): `variantCells` hücre ana sayısını süzgeçsiz ana koşudan kopyaladı
//   → ❌ 4 (§V1b hücre = süzgeçli kaynak · §V1c toplam ≤ ana 860 > 430 · §V2a yön 700 > 350 · §V4 fasoncu).
async function variantSection(): Promise<void> {
  console.log("── §V R1-VARYANT: küçük çoklular + dönem kıyası ──");
  const main = (await buildOrderDemandReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} })).sunum;
  const v = (await runCoreWithExtras({ range: SALES_RANGE, compareRange: SALES_PREV, dims: ORDER_DEMAND_DIMS, varyant: "musteri", run: orderDemandRunner({}, "prev") })).sunum;
  const cells = v.varyant?.hucreler ?? [];
  check("§V1a müşteri kırılımı: 2–6 hücre, büyükten küçüğe, ana sayı DEĞİŞMEZ", cells.length >= 2 && cells.length <= 6
    && cells.every((h, i) => i === 0 || (cells[i - 1]!.anaSayi.deger ?? 0) >= (h.anaSayi.deger ?? 0)) && v.anaSayi.deger === main.anaSayi.deger,
    cells.map((h) => `${h.ad}=${h.anaSayi.deger}`).join(" · "));
  let cellOk = cells.length > 0;
  for (const h of cells) {
    const src = await getOrderIntake(SALES_RANGE, SALES_PREV, { customerId: [h.deger] });
    if (h.anaSayi.deger !== src.summary.totalQty || h.anaSayi.kiyas?.deger !== src.summary.prevTotalQty) cellOk = false;
  }
  check("§V1b ⭐ tek değer varyantı = o değerle süzülmüş ana sayı (`getOrderIntake({customerId:[hücre]})` totalQty + önceki)", cellOk);
  const sum = cells.reduce((a, h) => a + (h.anaSayi.deger ?? 0), 0);
  check("§V1c ⭐ hücre toplamı ≤ ana sayı (metre)", cells.length > 0 && sum <= (main.anaSayi.deger ?? 0) + 1e-6 && sum > 0, `${sum} ≤ ${main.anaSayi.deger}`);
  check("§V1d beyan: `varyant` = musteri · `suzgecAnahtari` = customerId · müşteri çipi seçenekli",
    v.parametreler.find((x) => x.ad === "varyant")?.deger === "musteri" && v.varyant?.suzgecAnahtari === "customerId" && (v.parametreler.find((x) => x.ad === "customerId")?.secenekler?.length ?? 0) >= 2);

  const yon = (await runCoreWithExtras({ range: SALES_RANGE, compareRange: SALES_PREV, dims: SHIPPED_DIMS, varyant: "yon", run: shippedRunner(undefined, "prev") })).sunum;
  const shipMain = (await buildShippedReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: {} })).sunum;
  let yonOk = (yon.varyant?.hucreler ?? []).length === 2;
  for (const h of yon.varyant?.hucreler ?? []) {
    const one = (await buildShippedReport({ range: SALES_RANGE, compareRange: SALES_PREV, compareMode: "prev", filters: { destination: h.deger as ShipmentDestination } })).sunum;
    if (one.anaSayi.deger !== h.anaSayi.deger) yonOk = false;
  }
  const yonSum = (yon.varyant?.hucreler ?? []).reduce((a, h) => a + (h.anaSayi.deger ?? 0), 0);
  check("§V2a ⭐ sevk yön kırılımı: hücre = yön süzgeçli BRÜT sevk; toplam ≤ ana", yonOk && yonSum <= (shipMain.anaSayi.deger ?? 0) + 1e-6, `${yonSum} ≤ ${shipMain.anaSayi.deger}`);

  // Ana aralığın SONU fabrika gününün sonu (panelin gönderdiği gibi) → sütunlar Ocak · Şubat · Mart 2097.
  const perRange = { from: SALES_RANGE.from, to: factoryDayEndOfKey("2097-03-31") };
  const per = (await runCoreWithExtras({ range: perRange, compareRange: SALES_PREV, dims: ORDER_DEMAND_DIMS, donemler: { birim: "ay", adet: 3 }, run: orderDemandRunner({}, "prev") })).sunum;
  const ranges = periodRanges(perRange.to, { birim: "ay", adet: 3 });
  const lastR = ranges[2]!;
  const single = (await buildOrderDemandReport({ range: lastR, compareRange: ranges[1]!, compareMode: "prev", filters: {} })).sunum;
  const lastSrc = await getOrderIntake(lastR, ranges[1]!, {});
  const cols = per.donemler ?? [];
  check("§V3a ⭐ `donemler=ay:3` son sütun = o dönemin TEK koşusu (+bir önceki dönem kıyası) = kaynak totalQty",
    cols.length === 3 && cols[2]!.anaSayi.deger === single.anaSayi.deger && cols[2]!.anaSayi.deger === lastSrc.summary.totalQty && cols[2]!.anaSayi.kiyas?.deger === lastSrc.summary.prevTotalQty,
    cols.map((c) => `${c.etiket}=${c.anaSayi.deger}`).join(" · "));
  const firstSrc = await getOrderIntake(ranges[0]!, null, {});
  check("§V3b ilk sütunlar kıyassız ve kendi dönemlerinin kaynak değeri", cols.length === 3 && cols[0]!.anaSayi.deger === firstSrc.summary.totalQty && cols[0]!.anaSayi.kiyas === undefined);

  const open = (await runCoreWithExtras({ range: SALES_RANGE, compareRange: null, dims: OPEN_ORDER_DIMS, donemler: { birim: "ay", adet: 3 }, snapshotOnly: true, run: openOrderRunner(undefined) })).sunum;
  const openMain = (await buildOpenOrderReport({ filters: {} })).sunum;
  check("§V3c ⭐ kesit (açık siparişler): dönem değerleri ÖLÇÜLEMEDİ (null, 0 değil) + 'kesit görüntüsü' uyarısı; ana sayı aynı",
    (open.donemler ?? []).every((c) => c.anaSayi.deger === null && !!c.anaSayi.olculemedi) && open.uyarilar.some((u) => u.includes("kesit görüntüsü")) && open.anaSayi.deger === openMain.anaSayi.deger);
}

async function cleanupSales(): Promise<void> {
  await prisma.rollReturn.deleteMany({ where: { id: { in: salesIds.returns } } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: salesIds.sacks } } });
  await prisma.roll.deleteMany({ where: { id: { in: salesIds.rolls } } });
  await prisma.sack.deleteMany({ where: { id: { in: salesIds.sacks } } });
  await prisma.shipment.deleteMany({ where: { id: { in: salesIds.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: salesIds.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: salesIds.orders } } });
  if (salesItemId) await prisma.item.deleteMany({ where: { id: salesItemId } });
  if (salesColorId) await prisma.color.deleteMany({ where: { id: salesColorId } });
  await prisma.customer.deleteMany({ where: { id: { in: salesIds.customers } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// § Geçmiş kesit (R1-ZAMAN) — "defterden yeniden kurulan T kesiti = T anında alınmış kesit" mi?
// T anında yaşlandırma alınır (görüntü), sonra T'den SONRA olaylar yazılır ve T kesiti yeniden kurulur.
// Beklenen: sonraki kapama/iptal/geri alma sapma DOĞURMAZ; cari vade günü değişimi ve geriye tarihli
// belge sapma doğurur (ölçülen ve uyarıda beyan edilen iki kaynak). Negatif sonda (2026-10-25):
// yaşlandırmanın kapama geri sarması (`"createdAt" > asOf`) kaldırılınca 5 ❌ (§Z1–§Z5) · alacaklarda önceki
// değer `null`a çekilince 1 ❌ (§Z6).
// ─────────────────────────────────────────────────────────────────────────────
async function pastSnapshotSection(): Promise<void> {
  console.log("\n=== § Geçmiş kesit — alacaklar (R1-ZAMAN) ===");
  const TAG = `TEST-R1Z-${Date.now()}`;
  const DAY = 24 * 60 * 60 * 1000;
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  const box = await prisma.cashBox.create({ data: { code: TAG.slice(0, 32), name: `${TAG} Kasa`, currency: "TRY" }, select: { id: true } });
  let cariId: string | null = null;
  const invoice = async (total: number, issueAgo: number, dueAgo: number | null): Promise<string> => {
    const now = Date.now();
    const r = await invoiceService.createDraft({
      type: "SALES", customerId: customer.id, currency: "TRY", issueDate: new Date(now - issueAgo * DAY),
      dueDate: dueAgo === null ? null : new Date(now - dueAgo * DAY),
      lines: [{ description: `${TAG} satır`, qty: 1, unit: "m", unitPrice: total, vatRate: 0 }],
    });
    invoiceIds.push(r.data.id);
    await invoiceService.confirm(r.data.id);
    return r.data.id;
  };
  const payment = async (amount: number): Promise<string> => {
    const r = await paymentService.create({ direction: "IN", method: "CASH", customerId: customer.id, currency: "TRY", amount, cashBoxId: box.id });
    paymentIds.push(r.data.id);
    return r.data.id;
  };
  const overdueAt = async (at: Date): Promise<number> => {
    const b = (await getAgingReport({ asOf: at, cariId: cariId! })).blocks.find((x) => x.currency === "TRY");
    return b ? Number(b.totals.overdueTotal) : 0;
  };
  try {
    await withFlags({ [SETTING_KEYS.FINANCE_ENABLED]: true, [SETTING_KEYS.FINANCE_AUTO_ALLOCATE_ON_PAYMENT_ENABLED]: false }, async () => {
      // T öncesi: vadeli 1000 · vadesiz 500 (cari vade 30 gün) · 800'lük fatura + 300 kapama · sonra iptal edilecek 700.
      const inv1 = await invoice(1000, 60, 30);
      cariId = (await prisma.cariAccount.findFirstOrThrow({ where: { customerId: customer.id }, select: { id: true } })).id;
      await prisma.cariAccount.update({ where: { id: cariId }, data: { paymentTermDays: 30 } });
      await invoice(500, 60, null);
      const inv3 = await invoice(800, 50, 20);
      const pay3 = await payment(800);
      const early = await paymentAllocationService.allocate({ invoiceId: inv3, paymentId: pay3, amount: 300 });
      const inv4 = await invoice(700, 40, 10);
      await new Promise((r) => setTimeout(r, 20));
      const T = new Date();
      const snapshot = await overdueAt(T);
      await new Promise((r) => setTimeout(r, 20));
      check("§Z0 körlük zemini: T anı kesitinde vadesi geçmiş alacak var", snapshot > 0, `${snapshot}`);

      await paymentAllocationService.allocate({ invoiceId: inv3, paymentId: pay3, amount: 500 });
      const afterAlloc = await overdueAt(T);
      await invoiceService.cancel(inv4, "R1-ZAMAN ölçümü");
      const afterCancel = await overdueAt(T);
      await paymentAllocationService.deallocate(early.data.id);
      const afterRevoke = await overdueAt(T);
      await prisma.cariAccount.update({ where: { id: cariId }, data: { paymentTermDays: 90 } });
      const afterTerm = await overdueAt(T);
      await prisma.cariAccount.update({ where: { id: cariId }, data: { paymentTermDays: 30 } });
      await invoice(200, 60, 30);
      const afterBackdated = await overdueAt(T);
      console.log(`   ⓘ ölçüm (TRY): görüntü ${snapshot} · sonraki kapama ${afterAlloc} · iptal ${afterCancel} · kapama geri alma ${afterRevoke} · vade günü 30→90 ${afterTerm} · geriye tarihli belge ${afterBackdated}`);
      check("§Z1 ⭐ T'den sonraki kapama T kesitini değiştirmez (geri sarılır)", afterAlloc === snapshot, show(afterAlloc, snapshot));
      check("§Z2 ⭐ T'den sonraki fatura iptali T kesitini değiştirmez", afterCancel === snapshot, show(afterCancel, snapshot));
      check("§Z3 T'den önceki kapamanın sonradan geri alınması TOPLAMI değiştirmez (sanal mahsup karşılar)", afterRevoke === snapshot, show(afterRevoke, snapshot));
      check("§Z4 ⭐ ölçülen sapma: cari vade günü değişimi vadesiz faturayı kovadan çıkarır (uyarıda beyanlı)", afterTerm === snapshot - 500 && MONTH_END_REBUILT.includes("vade günü"), show(afterTerm, snapshot - 500));
      check("§Z5 ⭐ ölçülen sapma: geriye tarihli belge geçmiş kesite girer (uyarıda beyanlı)", afterBackdated === snapshot + 200 && MONTH_END_REBUILT.includes("geriye tarihli"), show(afterBackdated, snapshot + 200));
      // Rapor yolu: kıyas = aynı yaşlandırmanın geçen ay sonu kesiti (fikstür 60 gün önce düzenlendi → ay sonunda var).
      const nowAt = new Date();
      const rec = (await buildReceivablesReport(nowAt)).sunum;
      const prevB = (await getAgingReport({ asOf: factoryPreviousMonthEnd(nowAt) })).blocks.find((b) => b.currency === "TRY");
      check("§Z6 ⭐ alacaklar kıyası = geçen ay sonu kesiti (ölçülemedi DEĞİL) + defterden kuruldu uyarısı",
        Boolean(prevB) && same(rec.anaSayi.kiyas?.deger, Number(prevB!.totals.overdueTotal)) && rec.uyarilar.includes(MONTH_END_REBUILT)
          && rec.kiyasDonemi?.to === factoryPreviousMonthEnd(nowAt).toISOString(),
        show(rec.anaSayi.kiyas?.deger ?? null, prevB?.totals.overdueTotal ?? null));
      void inv1;
    });
  } finally {
    if (invoiceIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    if (paymentIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (paymentIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: paymentIds } } });
      await prisma.cashTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    }
    if (cariId) {
      await prisma.cariTransaction.deleteMany({ where: { cariId } });
      await prisma.cariBalance.deleteMany({ where: { cariId } });
      await prisma.cariAccount.deleteMany({ where: { id: cariId } });
    }
    await prisma.cashTransaction.deleteMany({ where: { cashBoxId: box.id } });
    await prisma.cashBox.deleteMany({ where: { id: box.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("\n=== Temel rapor sayı eşitliği ===");
  try {
    const { cD } = await salesSetup();
    await salesSection(cD);
    await variantSection();
  } finally {
    await cleanupSales();
  }
  try {
    await rapbSection();
    await rapcSection();
    await viewSection();
  } finally {
    await cleanup();
  }
  await pastSnapshotSection();
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
