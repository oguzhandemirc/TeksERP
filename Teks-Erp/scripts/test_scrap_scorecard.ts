// =============================================================================
// Test: FİRE KARNESİ
// Çalıştır: npx tsx scripts/test_scrap_scorecard.ts
// =============================================================================
// En kritik iki özellik ve neden burada:
//   1. MUTABAKAT — Fire Karnesi'nin `producedQty`'si Kalite Karnesi'nin
//      `totalQty`'si ile BİREBİR aynı olmalı. Ayrışırlarsa aynı ay için iki
//      farklı "üretim" rakamı dolaşıma girer ve hangisinin doğru olduğunu
//      kimse söyleyemez. Bu test iki servisi de çağırıp eşitliği ölçer.
//   2. ÇOK HATALI TOPTA ÇİFT SAYIM — hata bağı düz JOIN ile kurulsaydı 2 hatalı
//      100 m'lik top 200 m hurda görünürdü. Metraj topun kendisine aittir,
//      hatasına değil.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-SCR-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2098-05-01T00:00:00.000Z"),
  to: new Date("2098-05-31T23:59:59.999Z"),
};
const IN_WINDOW = new Date("2098-05-15T10:00:00.000Z");
const IN_PREV = new Date("2098-04-10T10:00:00.000Z");
/** Pencere DIŞI — "hata bu dönemde görüldü ama top başka dönemde hurdaya ayrıldı". */
const OUT_WINDOW = new Date("2098-07-20T10:00:00.000Z");

const rollIds: string[] = [];
const errorIds: string[] = [];

async function makeRoll(o: {
  itemId: string; qty: number; status: "SCRAP" | "WAREHOUSE" | "CANCELLED";
  finalizedAt: Date | null; entrySource?: "SUPPLIER_RECEIPT" | "SUBCONTRACTOR_RETURN";
  gradeId?: string | null;
}): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      itemId: o.itemId, initialQty: o.qty, currentQty: o.qty, status: o.status,
      entrySource: o.entrySource ?? "SUPPLIER_RECEIPT", finalizedAt: o.finalizedAt,
      qualityGradeId: o.gradeId ?? null, barcode: `${TAG}-${rollIds.length}`,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function makeError(rollId: string, defectTypeId: string | null, startMeter: number, detectedAt: Date, processed: boolean) {
  const e = await prisma.rollError.create({
    data: {
      rollId, defectTypeId, startMeter, detectedAt,
      isProcessed: processed,
      actionTaken: processed ? "CUT" : null,
      ...(processed ? { processedAt: detectedAt } : {}),
    },
    select: { id: true },
  });
  errorIds.push(e.id);
}

async function main(): Promise<void> {
  console.log("\n=== Fire Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const defects = await prisma.defectType.findMany({ take: 2, select: { id: true, name: true } });
  const grade = await prisma.qualityGrade.findFirst({ orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!item || defects.length < 2 || !grade) {
    console.log("❌ Ön koşul yok (1 kumaş + 2 hata türü + 1 kalite gerekli)");
    fail++;
    return;
  }
  const [d1, d2] = defects as [{ id: string; name: string }, { id: string; name: string }];

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  // Hurda (dönem içi): 100 m (İKİ hatalı — çift sayım sondası) + 40 m fason
  const twoDefect = await makeRoll({ itemId: item.id, qty: 100, status: "SCRAP", finalizedAt: IN_WINDOW });
  await makeError(twoDefect, d1.id, 10, IN_WINDOW, true);
  await makeError(twoDefect, d2.id, 55, IN_WINDOW, true);
  await makeRoll({
    itemId: item.id, qty: 40, status: "SCRAP", finalizedAt: IN_WINDOW,
    entrySource: "SUBCONTRACTOR_RETURN",
  });
  // Üretim (hurda olmayan) — payda: 100 + 40 + 860 = 1000 m
  await makeRoll({ itemId: item.id, qty: 860, status: "WAREHOUSE", finalizedAt: IN_WINDOW, gradeId: grade.id });
  // K18 ÖLÜ statüsünde, dönem içinde damgalı top. Paydaya GİRMEMELİ.
  // ⚠️ Bu satır TESTİN GÖREBİLİRLİĞİ için load-bearing: onsuz "K18 dışlaması"
  // kontrolü VAKUMEN yeşil kalıyordu — süzgeci silen negatif sonda hiçbir şeyi
  // kırmıyordu (ölçüldü). Fixture'da dışlanacak veri yoksa dışlama test edilemez.
  await makeRoll({ itemId: item.id, qty: 300, status: "CANCELLED", finalizedAt: IN_WINDOW, gradeId: grade.id });
  // Önceki dönem: 50 m hurda / 200 m toplam üretim → %25
  await makeRoll({ itemId: item.id, qty: 50, status: "SCRAP", finalizedAt: IN_PREV });
  await makeRoll({ itemId: item.id, qty: 150, status: "WAREHOUSE", finalizedAt: IN_PREV, gradeId: grade.id });
  // Hatası dönemde GÖRÜLEN ama başka dönemde hurdaya ayrılan top → yalnız
  // tespit tablosunda görünmeli, hurda metrajına GİRMEMELİ (iki çıpa ayrımı).
  const laterScrap = await makeRoll({ itemId: item.id, qty: 500, status: "SCRAP", finalizedAt: OUT_WINDOW });
  await makeError(laterScrap, d1.id, 5, IN_WINDOW, false); // açık hata

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getScrapScorecard(RANGE, compareRange);
  const qc = await getQualityScorecard(RANGE, null);

  // ── 1) ÇİFT SAYIM SEDDİ ───────────────────────────────────────────────────
  console.log("── 1) Çok hatalı topta metraj çift sayılmaz ──");
  check("hurda metrajı 140 m", sc.summary.scrapQty === 140, `gelen: ${sc.summary.scrapQty}`);
  check("hurda top adedi 2", sc.summary.scrapRollCount === 2, `gelen: ${sc.summary.scrapRollCount}`);
  const defectSum = Math.round(sc.scrapByDefect.reduce((a, r) => a + r.qty, 0) * 10) / 10;
  check("hata kırılımı toplamı = hurda metrajı", defectSum === 140, `${defectSum} ↔ 140`);
  check(
    "iki hatalı top TEK hataya atfedilir (en erken tespit)",
    sc.scrapByDefect.find((r) => r.label === d1.name)?.qty === 100,
    `gelen: ${sc.scrapByDefect.find((r) => r.label === d1.name)?.qty}`,
  );

  // ── 2) MUTABAKAT — iki karne aynı üretim rakamını söyler ──────────────────
  console.log("\n── 2) Kalite Karnesi ile mutabakat ──");
  check(
    "üretim metrajı 1000 m — iptal edilmiş 300 m paydaya GİRMEZ",
    sc.summary.producedQty === 1000,
    `gelen: ${sc.summary.producedQty} (K18 süzgeci düşerse 1300 olur)`,
  );
  check(
    "Fire Karnesi producedQty = Kalite Karnesi totalQty (BİREBİR)",
    sc.summary.producedQty === qc.summary.totalQty,
    `${sc.summary.producedQty} ↔ ${qc.summary.totalQty}`,
  );
  check("fire oranı %14", sc.summary.scrapPct === 14, `gelen: ${sc.summary.scrapPct}`);

  // ── 3) İKİ ÇIPA AYRIMI ────────────────────────────────────────────────────
  console.log("\n── 3) Hurda çıpası (finalizedAt) ↔ tespit çıpası (detectedAt) ──");
  check(
    "başka dönemde hurdalanan top HURDA metrajına girmez",
    sc.summary.scrapQty === 140,
    "500 m sayılsaydı 640 olurdu",
  );
  check(
    "ama hatası dönemde TESPİT edildiği için tespit tablosunda var",
    sc.summary.defectsDetected === 3,
    `gelen: ${sc.summary.defectsDetected}`,
  );
  check("karara bağlanmamış hata sayısı 1", sc.summary.defectsOpen === 1, `gelen: ${sc.summary.defectsOpen}`);
  check(
    "tespit tablosu ADET taşır (metre değil) — toplanamaz olsun diye",
    sc.detectionByDefect.every((r) => typeof r.count === "number" && !("qty" in r)),
  );
  const d1row = sc.detectionByDefect.find((r) => r.key === d1.id);
  check("hata türü kararları ayrışıyor (kesildi/açık)", d1row?.cutCount === 1 && d1row?.openCount === 1,
    `cut=${d1row?.cutCount} open=${d1row?.openCount}`);

  // ── 4) FASON ATFI ─────────────────────────────────────────────────────────
  console.log("\n── 4) Fason atfı (Kalite Karnesi ile aynı üç kova) ──");
  const unknown = sc.bySource.find((r) => r.key === "__SUB_UNKNOWN__");
  const inhouse = sc.bySource.find((r) => r.key === "__INHOUSE__");
  check("firması bilinmeyen fason hurdası ayrı kovada", unknown?.qty === 40, `gelen: ${unknown?.qty}`);
  check("fabrika içi o 40 m'yi almaz", inhouse?.qty === 100, `gelen: ${inhouse?.qty}`);

  // ── 5) KIRILIM TOPLAMLARI ─────────────────────────────────────────────────
  console.log("\n── 5) Kırılım toplamları = özet ──");
  const sum = (rows: { qty: number }[]) => Math.round(rows.reduce((a, r) => a + r.qty, 0) * 10) / 10;
  check("kumaş kırılımı", sum(sc.byItem) === 140, `${sum(sc.byItem)}`);
  check("renk kırılımı", sum(sc.byColor) === 140, `${sum(sc.byColor)}`);
  check("kaynak kırılımı", sum(sc.bySource) === 140, `${sum(sc.bySource)}`);
  const dailySum = Math.round(sc.daily.reduce((a, d) => a + d.scrapQty, 0) * 10) / 10;
  check("günlük seri", dailySum === 140, `${dailySum}`);

  // ── 6) KARŞILAŞTIRMA ──────────────────────────────────────────────────────
  console.log("\n── 6) Dönem karşılaştırma ──");
  check("önceki dönem hurda 50 m", sc.summary.prevScrapQty === 50, `gelen: ${sc.summary.prevScrapQty}`);
  check("önceki dönem fire oranı %25", sc.summary.prevScrapPct === 25, `gelen: ${sc.summary.prevScrapPct}`);
  check(
    "oran ÇİFT dönemden hesaplanır (pay ve payda ayrı ayrı)",
    sc.summary.prevScrapPct !== sc.summary.scrapPct,
    "payda sabitlenseydi %25 yerine %5 çıkardı",
  );
  check("kırılım satırında önceki dönem taşınıyor", sc.byItem[0]?.prevQty === 50, `gelen: ${sc.byItem[0]?.prevQty}`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (errorIds.length) await prisma.rollError.deleteMany({ where: { id: { in: errorIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
