// =============================================================================
// Test: KALİTE KARNESİ + üretim zaman çıpası trigger'ı
// Çalıştır: npx tsx scripts/test_quality_scorecard.ts
// =============================================================================
// Bu bekçi İKİ katmanı birden kilitler, çünkü rapor doğruluğu ikisinin
// birleşimidir:
//   A) TRIGGER (migration 20260809090000) — `Roll.finalizedAt` DOĞRU ANLARDA
//      yazılıyor mu, ve DAHA ÖNEMLİSİ yanlış anlarda YAZILMIYOR mu (storno/iade).
//   B) RAPOR — bilinen bir fixture'dan bilinen bir cevap üretiyor mu.
//
// Fixture 2099 penceresine kurulur (seed/komşu test sızmasın) ve `finalizedAt`
// AÇIKÇA verilir — trigger'ın INSERT dalı zaten "değer verilmişse dokunma" der,
// yani bu hem pencereyi sabitler hem de o dalı doğrular.
//
// ⚠️ Raporun EN KOLAY sessizce bozulan üç özelliği ve neden burada:
//   1. METRAJ ağırlığı — adet sayımına dönerse oran anlamsızlaşır ama rapor
//      "çalışmaya" devam eder (sayılar makul görünür).
//   2. K18 dışlaması — tüketilmiş ebeveyn sayılırsa aynı kumaş İKİ KEZ sayılır;
//      toplam şişer, oran kayar, hiçbir hata çıkmaz.
//   3. Fason atfı — firması çözülemeyen fason topu "Fabrika içi"ne yazılırsa
//      rapor tam da cevaplamak için var olduğu sorunun TERSİNİ söyler.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { readFileSync } from "fs";
import { join } from "path";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const TAG = `TEST-QSC-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2099-03-01T00:00:00.000Z"),
  to: new Date("2099-03-31T23:59:59.999Z"),
};
const IN_WINDOW = new Date("2099-03-15T10:00:00.000Z");
/** Önceki dönem penceresine (compare=prev) düşen an. */
const IN_PREV = new Date("2099-02-10T10:00:00.000Z");

const createdRollIds: string[] = [];

async function makeRoll(opts: {
  itemId: string;
  colorId?: string | null;
  qty: number;
  gradeId?: string | null;
  status: "WAREHOUSE" | "A1_STOCK" | "SCRAP" | "TAMBUR_CONSUMED" | "CANCELLED" | "IN_PRODUCTION";
  finalizedAt: Date | null;
  entrySource?: "SUPPLIER_RECEIPT" | "SUBCONTRACTOR_RETURN";
}): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      itemId: opts.itemId,
      colorId: opts.colorId ?? null,
      initialQty: opts.qty,
      currentQty: opts.qty,
      status: opts.status,
      entrySource: opts.entrySource ?? "SUPPLIER_RECEIPT",
      qualityGradeId: opts.gradeId ?? null,
      finalizedAt: opts.finalizedAt,
      barcode: `${TAG}-${createdRollIds.length}`,
    },
    select: { id: true },
  });
  createdRollIds.push(r.id);

  // ⚠️ ÇIPASIZ TOP TRIGGER'A RAĞMEN KURULUR — `finalizedAt: null` GÖNDERMEK YETMEZ.
  // Trigger'ın INSERT dalı tam da bunu yapar: final statüde doğan ve damgası
  // olmayan topa `now()` yazar. Yani fixture "çıpasız" istese de satır damgalı
  // doğar ve `unanchoredRollCount` 0 kalır.
  //
  // Bu, CI'ı 2026-08-09'da kırmızıya düşüren şeydi: dev DB'de migration ÖNCESİNDEN
  // kalma çıpasız toplar var, o yüzden yerelde yeşildi; temiz CI DB'sinde her top
  // trigger'dan geçtiği için sayaç 0 çıkıyordu. Test ortamın eski verisine
  // yaslanıyordu (`CLAUDE.md`: "Ortamdaki veriye BAĞIMLI OLMA").
  //
  // Çözüm, trigger'ı devre dışı bırakmak DEĞİL (o zaman kuralı test etmeyi
  // bırakırdık): statüye DOKUNMADAN ham UPDATE ile damgayı silmek. Trigger'ın
  // UPDATE dalı yalnız `status` GERÇEKTEN değiştiğinde çalışır, bu yüzden bu
  // yazım ondan sessizce geçer — ve sonuç, migration öncesinden kalmış bir eski
  // satırın BİREBİR aynısıdır. Yani fixture gerçek dünyayı taklit ediyor.
  if (opts.finalizedAt === null && ["WAREHOUSE", "A1_STOCK", "SCRAP"].includes(opts.status)) {
    await prisma.$executeRaw`UPDATE "rolls" SET "finalizedAt" = NULL WHERE "id" = ${r.id}::uuid`;
  }
  return r.id;
}

async function main(): Promise<void> {
  console.log("\n=== Kalite Karnesi + üretim çıpası bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const item2 = await prisma.item.findFirst({
    where: { isActive: true, id: { not: item?.id } },
    select: { id: true, name: true },
  });
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const catalog = await prisma.qualityGrade.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, name: true, sortOrder: true },
  });
  if (!item || !item2 || catalog.length < 2) {
    console.log("❌ Ön koşul yok (en az 2 aktif kumaş + 2 kalite gerekli)");
    fail++;
    return;
  }
  const TOP = catalog[0]; // en üst sıradaki kalite — koda GÖMÜLMEZ, veriden gelir
  const SECOND = catalog[1];

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  // Dönem içi (beklenen karne):
  //   1000 m üst kalite  + 100 m ikinci kalite + 50 m kalitesiz   = 1150 m
  //   +  20 m FİRE (SCRAP) → dahil olmalı                          = 1170 m
  // Dışlanması gerekenler: 500 m TAMBUR_CONSUMED · 400 m CANCELLED · pencere dışı
  await makeRoll({ itemId: item.id, colorId: color?.id, qty: 1000, gradeId: TOP.id, status: "WAREHOUSE", finalizedAt: IN_WINDOW });
  await makeRoll({ itemId: item.id, colorId: color?.id, qty: 100, gradeId: SECOND.id, status: "A1_STOCK", finalizedAt: IN_WINDOW });
  await makeRoll({ itemId: item.id, colorId: null, qty: 50, gradeId: null, status: "WAREHOUSE", finalizedAt: IN_WINDOW });
  await makeRoll({ itemId: item2.id, colorId: null, qty: 20, gradeId: null, status: "SCRAP", finalizedAt: IN_WINDOW });
  const consumedId = await makeRoll({ itemId: item.id, qty: 500, gradeId: TOP.id, status: "TAMBUR_CONSUMED", finalizedAt: IN_WINDOW });
  await makeRoll({ itemId: item.id, qty: 400, gradeId: TOP.id, status: "CANCELLED", finalizedAt: IN_WINDOW });
  // Fason dönüşü ama makbuzu YOK → "Fason (firma belirsiz)" kovasına düşmeli
  await makeRoll({
    itemId: item2.id, qty: 200, gradeId: TOP.id, status: "WAREHOUSE",
    finalizedAt: IN_WINDOW, entrySource: "SUBCONTRACTOR_RETURN",
  });
  // Önceki dönem (compare=prev): 300 m üst kalite + 300 m ikinci kalite = %50
  await makeRoll({ itemId: item.id, qty: 300, gradeId: TOP.id, status: "WAREHOUSE", finalizedAt: IN_PREV });
  await makeRoll({ itemId: item.id, qty: 300, gradeId: SECOND.id, status: "A1_STOCK", finalizedAt: IN_PREV });
  // Çıpası olmayan (finalizedAt NULL) final statülü top → kapsam sayacına düşmeli
  await makeRoll({ itemId: item.id, qty: 77, gradeId: TOP.id, status: "WAREHOUSE", finalizedAt: null });

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getQualityScorecard(RANGE, compareRange);

  // ── 1) METRAJ AĞIRLIĞI ────────────────────────────────────────────────────
  // Fixture'ın toplamı = 1000 + 100 + 50 + 20 (fire) + 200 (fason) = 1370 m
  // Üst kalite = 1000 + 200 = 1200 m → %87,6
  // ADET bazlı olsaydı: 5 topun 2'si üst kalite = %40 → aradaki fark testin özü.
  const mine = <T extends { key: string }>(rows: T[], key: string): T | undefined =>
    rows.find((r) => r.key === key);
  console.log("── 1) Metraj ağırlıklı oran ──");
  check("toplam metraj 1370 m", sc.summary.totalQty === 1370, `gelen: ${sc.summary.totalQty}`);
  check("top adedi 5", sc.summary.rollCount === 5, `gelen: ${sc.summary.rollCount}`);
  check(
    "üst kalite payı %87,6 (metraj) — adet bazlı olsaydı %40 çıkardı",
    sc.summary.topGrade?.pct === 87.6,
    `gelen: ${sc.summary.topGrade?.pct}`,
  );
  check("kalitesiz metraj 70 m ayrı raporlanır", sc.summary.ungradedQty === 70, `gelen: ${sc.summary.ungradedQty}`);
  check("kaliteli metraj 1300 m", sc.summary.gradedQty === 1300, `gelen: ${sc.summary.gradedQty}`);

  // ── 2) K18 DIŞLAMA / SCRAP DAHİL ──────────────────────────────────────────
  console.log("\n── 2) Kapsam: tüketilmiş dışarıda, fire içeride ──");
  check(
    "TAMBUR_CONSUMED ebeveyn SAYILMAZ (çift sayım seddi)",
    sc.summary.totalQty === 1370,
    "500 m sayılsaydı toplam 1870 olurdu",
  );
  check(
    "CANCELLED SAYILMAZ",
    !sc.grades.some((g) => g.qty === 400),
    "400 m iptal edilmiş top karnede görünmemeli",
  );
  const fireRow = sc.byItem.find((r) => r.key === item2.id);
  check("SCRAP (fire) SAYILIR — üretim sonucudur", fireRow !== undefined && fireRow.totalQty === 220, `gelen: ${fireRow?.totalQty}`);

  // ── 3) TEK KAYNAK: kırılım toplamları özetle BİREBİR ──────────────────────
  // Dört tabloyu ayrı sorgulardan üretmenin klasik arızası: birbirini tutmayan
  // toplamlar. Tek GROUP BY'dan türetildiği için bu yapısal olarak imkânsız —
  // ama refactor sırasında bozulabilir, o yüzden kilitli.
  console.log("\n── 3) Kırılım toplamları = özet toplamı ──");
  const sum = (rows: { totalQty: number }[]) => Math.round(rows.reduce((a, r) => a + r.totalQty, 0) * 10) / 10;
  check("kumaş kırılımı toplamı", sum(sc.byItem) === sc.summary.totalQty, `${sum(sc.byItem)} ↔ ${sc.summary.totalQty}`);
  check("renk kırılımı toplamı", sum(sc.byColor) === sc.summary.totalQty, `${sum(sc.byColor)} ↔ ${sc.summary.totalQty}`);
  check("fason kırılımı toplamı", sum(sc.bySubcontractor) === sc.summary.totalQty, `${sum(sc.bySubcontractor)} ↔ ${sc.summary.totalQty}`);
  const dailySum = Math.round(sc.daily.reduce((a, d) => a + d.totalQty, 0) * 10) / 10;
  check("günlük seri toplamı", dailySum === sc.summary.totalQty, `${dailySum} ↔ ${sc.summary.totalQty}`);
  const gradeSum = Math.round(sc.grades.reduce((a, g) => a + g.qty, 0) * 10) / 10;
  check("kalite dağılımı toplamı", gradeSum === sc.summary.totalQty, `${gradeSum} ↔ ${sc.summary.totalQty}`);

  // ── 4) FASON ATFI — yanlış atıf seddi ─────────────────────────────────────
  console.log("\n── 4) Fason atfı: firması bilinmeyen fason topu fabrikaya yazılmaz ──");
  const unknownSub = mine(sc.bySubcontractor, "__SUB_UNKNOWN__");
  const inhouse = mine(sc.bySubcontractor, "__INHOUSE__");
  check("belirsiz fason kovası var ve 200 m taşıyor", unknownSub?.totalQty === 200, `gelen: ${unknownSub?.totalQty}`);
  check("etiketi 'Fabrika içi' DEĞİL", unknownSub?.label === "Fason (firma belirsiz)", `gelen: ${unknownSub?.label}`);
  check("fabrika içi kovası o 200 m'yi ALMAZ", inhouse?.totalQty === 1170, `gelen: ${inhouse?.totalQty}`);

  // ── 5) DÖNEM KARŞILAŞTIRMA ────────────────────────────────────────────────
  console.log("\n── 5) Dönem karşılaştırma ──");
  check("karşılaştırma aralığı çözüldü", compareRange !== null);
  check(
    "önceki dönem ana dönemle ÇAKIŞMAZ (bitiş = başlangıç − 1 ms)",
    compareRange !== null && compareRange.to.getTime() === RANGE.from.getTime() - 1,
    `${compareRange?.to.toISOString()} ↔ ${RANGE.from.toISOString()}`,
  );
  check("önceki dönem metrajı 600 m", sc.summary.prevTotalQty === 600, `gelen: ${sc.summary.prevTotalQty}`);
  check("önceki dönem üst kalite payı %50", sc.summary.prevTopGradePct === 50, `gelen: ${sc.summary.prevTopGradePct}`);
  const topGradeRow = sc.grades.find((g) => g.code === TOP.code);
  check("kalite satırında önceki dönem metrajı 300 m", topGradeRow?.prevQty === 300, `gelen: ${topGradeRow?.prevQty}`);
  const itemRow = sc.byItem.find((r) => r.key === item.id);
  check(
    "kırılım satırında önceki dönem taşınıyor",
    itemRow?.prevTotalQty === 600,
    `gelen: ${itemRow?.prevTotalQty}`,
  );

  // ── 6) KAPSAM DÜRÜSTLÜĞÜ ──────────────────────────────────────────────────
  console.log("\n── 6) Kapsam dürüstlüğü ──");
  check(
    "çıpasız final-statülü toplar SAYILIP raporlanıyor (gizlenmiyor)",
    sc.unanchoredRollCount >= 1,
    `gelen: ${sc.unanchoredRollCount}`,
  );

  // ── 7) "1. KALİTE" KODA GÖMÜLÜ DEĞİL ──────────────────────────────────────
  console.log("\n── 7) Üst kalite veriden çözülür, koda gömülmez ──");
  check("topGradeCode = katalogun ilk sırası", sc.topGradeCode === TOP.code, `${sc.topGradeCode} ↔ ${TOP.code}`);
  const src = readFileSync(
    join(__dirname, "../src/services/reports/quality-scorecard.report.service.ts"),
    "utf8",
  );
  // Yorum satırları hariç KOD içinde kalite kodu literali aranır. Bir gün biri
  // `code === "1.KALITE"` yazarsa rapor o fabrikada çalışır, kaliteyi yeniden
  // adlandıran fabrikada SESSİZCE boş karne üretir.
  const codeOnly = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("--"))
    .join("\n");
  check(
    "servis kodunda sabit kalite kodu literali yok",
    !/["']1\.KALITE["']/.test(codeOnly) && !/["']A1["']/.test(codeOnly),
    "kalite kodu koda gömülürse katalogu değiştiren fabrikada karne sessizce bozulur",
  );

  // ── 8) TRIGGER: storno/iade damgayı TAZELEMEZ ─────────────────────────────
  // Raporun dönem doğruluğu tamamen buna dayanıyor: sevkten dönen bir top
  // bugünün karnesine girerse hem bu ay hem üretildiği ay yanlış olur.
  console.log("\n── 8) Trigger: sevk → storno damgayı tazelemez ──");
  const stampProbe = await makeRoll({
    itemId: item.id, qty: 10, gradeId: TOP.id, status: "IN_PRODUCTION", finalizedAt: null,
  });
  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "WAREHOUSE" } });
  const afterFinalize = await prisma.roll.findUnique({
    where: { id: stampProbe },
    select: { finalizedAt: true, statusChangedAt: true },
  });
  check("üretim → depo geçişi damgalandı", afterFinalize?.finalizedAt != null);

  // Damgayı geçmişe sabitle: `now()` işlem başlangıcı olduğu için aynı işlemde
  // "değişti mi" karşılaştırması körleşir (ölçüldü) — sabitlemek tek güvenilir yol.
  const PINNED = new Date("2020-01-01T00:00:00.000Z");
  await prisma.$executeRaw`UPDATE rolls SET "finalizedAt" = ${PINNED} WHERE id = ${stampProbe}::uuid`;
  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "SHIPPED" } });
  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "WAREHOUSE" } });
  const afterStorno = await prisma.roll.findUnique({
    where: { id: stampProbe },
    select: { finalizedAt: true },
  });
  check(
    "SHIPPED → WAREHOUSE (storno/iade) damgayı DEĞİŞTİRMEZ",
    afterStorno?.finalizedAt?.getTime() === PINNED.getTime(),
    `gelen: ${afterStorno?.finalizedAt?.toISOString()}`,
  );

  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "IN_PRODUCTION" } });
  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "A1_STOCK" } });
  const afterRework = await prisma.roll.findUnique({
    where: { id: stampProbe },
    select: { finalizedAt: true },
  });
  check(
    "yeniden üretim → yeni final: damga TAZELENİR (kalite ile aynı olaydan gelmeli)",
    (afterRework?.finalizedAt?.getTime() ?? 0) > PINNED.getTime(),
    `gelen: ${afterRework?.finalizedAt?.toISOString()}`,
  );

  // ── 9) statusChangedAt her geçişte tazelenir, statü dışı yazımda DEĞİL ────
  console.log("\n── 9) statusChangedAt sözleşmesi ──");
  await prisma.$executeRaw`UPDATE rolls SET "statusChangedAt" = ${PINNED} WHERE id = ${stampProbe}::uuid`;
  await prisma.roll.update({ where: { id: stampProbe }, data: { labelPrintedAt: new Date() } });
  const afterNonStatus = await prisma.roll.findUnique({
    where: { id: stampProbe },
    select: { statusChangedAt: true },
  });
  check(
    "statü DIŞI güncelleme (etiket basımı) damgaya dokunmaz",
    afterNonStatus?.statusChangedAt?.getTime() === PINNED.getTime(),
    "bu ayrım olmasaydı updatedAt'ten farkı kalmazdı",
  );
  await prisma.roll.update({ where: { id: stampProbe }, data: { status: "WAREHOUSE" } });
  const afterStatus = await prisma.roll.findUnique({
    where: { id: stampProbe },
    select: { statusChangedAt: true },
  });
  check(
    "statü değişimi damgayı tazeler",
    (afterStatus?.statusChangedAt?.getTime() ?? 0) > PINNED.getTime(),
  );

  void consumedId;
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    if (createdRollIds.length > 0) {
      await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
