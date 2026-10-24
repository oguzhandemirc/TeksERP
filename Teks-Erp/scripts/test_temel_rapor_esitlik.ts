// =============================================================================
// TEMEL RAPOR SAYI EŞİTLİĞİ — Raporlar v2 R0 (gerçek DB)
// =============================================================================
// NEDEN: temel raporlar (`services/reports/temel/*`) YENİ SQL yazmaz; her ana/yan sayı mevcut bir
// karnenin alanıdır (plan §2 P2). Bu bekçi her sayıyı AYNI parametreyle kaynağıyla ölçer — sunum
// katmanı kendi hesabını yaparsa (ağırlık, payda, kova) eski raporla ayrışır ve kırmızı olur.
//
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
// Temiz koşum 26/0.
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
// Temiz koşum 54/0 (RAPB + RAPC).
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
import coreWeavingFinanceRouter, { permissionOf as rapcPermissionOf } from "../src/routes/reports/temel-dokuma-finans.routes";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { buildLoomEfficiencyReport, efficiencyReasonText } from "../src/services/reports/temel/tezgah-randimani.temel";
import { buildLoomStopsReport, mostFrequentReason, secondsToMinutes } from "../src/services/reports/temel/duruslar.temel";
import { beamBalance, buildBeamBalanceReport } from "../src/services/reports/temel/levent-dengesi.temel";
import { buildReceivablesReport, mainBlock, NO_MONTH_END_RECEIVABLES, receivedChequesDue } from "../src/services/reports/temel/alacaklar.temel";
import { durusParetoReport, efficiencyReport } from "../src/services/reports/dokuma.report.service";
import { capacityUsageReport } from "../src/services/reports/kapasite-kullanimi.report.service";
import { alarmResponseReport } from "../src/services/reports/alarm-response.report.service";
import { getAgingReport } from "../src/services/reports/finance-aging.report";
import { chequeService } from "../src/services/cheque.service";
import { yasakSozcukBul } from "../src/services/reports/anlati/yasak-sozcuk";

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

// =============================================================================
// § Dokuma/finans (RAPC) — `dokuma/tezgah-randimani`, `dokuma/duruslar`, `dokuma/levent-dengesi`, `finance/alacaklar`
// =============================================================================
const RAPC_KEYS: ReportKey[] = ["dokuma/tezgah-randimani", "dokuma/duruslar", "dokuma/levent-dengesi", "finance/alacaklar"];
const RAPC_DAYS = { from: "2097-07-01", to: "2097-07-31" };
const rapcShiftDefs: string[] = [];
type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;
type RouteLayer = { route?: { path: string; stack: Array<{ handle: Handler; name: string }> } };

/** Ucun modül kapısı öneki (`require*Enabled`) — Express yığınından, gerçek fonksiyonlarla koşar. */
async function runModuleGates(path: string): Promise<{ gates: string[]; err: unknown }> {
  const layer = (coreWeavingFinanceRouter as unknown as { stack: RouteLayer[] }).stack.find((l) => l.route?.path === path);
  const gates = (layer?.route?.stack ?? []).filter((h) => /^require\w*Enabled$/.test(h.name));
  for (const g of gates) {
    const err = await new Promise<unknown>((resolve) => {
      void Promise.resolve(g.handle({ headers: {}, query: {} }, {}, (e?: unknown) => resolve(e ?? null)));
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
    check("§C4c kesit kıyası ölçülemedi + ay sonu uyarısı (0'a çökmez)", rec.anaSayi.kiyas?.deger === null && rec.uyarilar.includes(NO_MONTH_END_RECEIVABLES));
  } else check("§C4c ay sonu uyarısı (blok yok)", rec.uyarilar.includes(NO_MONTH_END_RECEIVABLES));
  const fakeBlock = (currency: string) => ({ currency, totals: { overdueTotal: "1" } }) as unknown as Parameters<typeof mainBlock>[0][number];
  check("§C4d para birimleri toplanmaz: TL varsa TL, iki yabancı birimde ana sayı seçilmez",
    mainBlock([fakeBlock("USD"), fakeBlock("TRY")])?.currency === "TRY" && mainBlock([fakeBlock("USD"), fakeBlock("EUR")]) === null && mainBlock([fakeBlock("EUR")])?.currency === "EUR");

  const banned = [eff, stops, rec].flatMap((s) => yasakSozcukBul(JSON.stringify(s)).map((w) => `${s.anahtar}: ${w}`));
  check("§C5 sunum metinlerinde yasak sözcük yok", banned.length === 0, banned.join(", ") || "temiz");
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

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("\n=== Temel rapor sayı eşitliği ===");
  try {
    await rapbSection();
    await rapcSection();
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
