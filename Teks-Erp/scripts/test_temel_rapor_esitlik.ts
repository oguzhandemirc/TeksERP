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

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("\n=== Temel rapor sayı eşitliği ===");
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
