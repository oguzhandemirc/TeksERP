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
// Temiz koşum 60/0 (§ Satış 34 + § RAPB 26).
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
import { buildShippedReport } from "../src/services/reports/temel/sevkiyat.temel";
import { buildDeadlineReport } from "../src/services/reports/temel/termin.temel";
import { buildOpenOrderReport } from "../src/services/reports/temel/acik-siparisler.temel";
import { buildLostWorkReport } from "../src/services/reports/temel/vazgecilen-is.temel";

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

  // §R5 Fasoncular = fason karnesi (K-FASON)
  const subR = (await buildSubcontractorsReport({ range: RANGE, compareRange, compareMode: mode, filters: {} })).sunum;
  check("§R5a ⭐ ana sayı ortalama dönüş = `summary.avgTurnaroundDays` (+önceki `prevAvgTurnaroundDays`)",
    subR.anaSayi.olcu === "fason.ortalamaDonusGun" && same(subR.anaSayi.deger, sub.summary.avgTurnaroundDays) && same(subR.anaSayi.kiyas?.deger, sub.summary.prevAvgTurnaroundDays),
    show([subR.anaSayi.deger, subR.anaSayi.kiyas?.deger], [sub.summary.avgTurnaroundDays, sub.summary.prevAvgTurnaroundDays]));
  check("§R5b fikstür: dönüş 4 gün, önceki 10 gün", same(subR.anaSayi.deger, 4) && same(subR.anaSayi.kiyas?.deger, 10));
  check("§R5c yanlar = `openQty` (bekleyen) · `fireQty` (eksik dönen)",
    same(fig(subR, "fason.bekleyenMetre")?.deger, sub.summary.openQty) && same(fig(subR, "fire.fasonMetre")?.deger, sub.summary.fireQty) && subR.yanSayilar.length === 2);
  const subOne = (await buildSubcontractorsReport({ range: RANGE, compareRange, compareMode: mode, filters: { subcontractorId: [subId] } })).sunum;
  const subOneSrc = await getSubcontractScorecard(RANGE, compareRange, { subcontractorId: [subId] });
  check("§R5d süzgeçli vaka (fasoncu): ana + yanlar kaynağın AYNI süzgeçli değeri",
    same(subOne.anaSayi.deger, subOneSrc.summary.avgTurnaroundDays) && same(fig(subOne, "fason.bekleyenMetre")?.deger, subOneSrc.summary.openQty)
      && same(fig(subOne, "fire.fasonMetre")?.deger, subOneSrc.summary.fireQty) && subOneSrc.summary.openQty !== sub.summary.openQty,
    show(fig(subOne, "fason.bekleyenMetre")?.deger, subOneSrc.summary.openQty));
}

async function cleanup(): Promise<void> {
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

async function customer(n: string, d: ShipmentDestination): Promise<string> {
  const c = await prisma.customer.create({ data: { code: `${SALES_TAG}-${n}`, name: `${SALES_TAG} ${n}`, defaultDestination: d }, select: { id: true } });
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

async function cleanupSales(): Promise<void> {
  await prisma.rollReturn.deleteMany({ where: { id: { in: salesIds.returns } } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: salesIds.sacks } } });
  await prisma.roll.deleteMany({ where: { id: { in: salesIds.rolls } } });
  await prisma.sack.deleteMany({ where: { id: { in: salesIds.sacks } } });
  await prisma.shipment.deleteMany({ where: { id: { in: salesIds.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: salesIds.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: salesIds.orders } } });
  if (salesItemId) await prisma.item.deleteMany({ where: { id: salesItemId } });
  await prisma.customer.deleteMany({ where: { id: { in: salesIds.customers } } });
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
  } finally {
    await cleanupSales();
  }
  try {
    await rapbSection();
  } finally {
    await cleanup();
  }
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
