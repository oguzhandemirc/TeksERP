// =============================================================================
// test_rapor_istatistik — analiz/korelasyon motoru (Raporlar v2 R3-ISTAT; plan §3.8)
// =============================================================================
// §1 dağılımlar (DB'siz): t ve ki-kare kuyrukları ders kitabı tablolarıyla DÖRT HANE
//    (t₁₀ 2,228 → 0,05 · χ²₁ 3,841 → 0,05 · χ²₅ 11,07 → 0,05 · χ²₂ CDF(2) = 1−e⁻¹ · Cauchy t₁(1) = 0,75).
// §2 testler (DB'siz): Anscombe dörtlüsü r = 0,816 (Anscombe 1973) · Anscombe I p = 0,0022 (scipy
//    `pearsonr`) · eşitlikli Spearman 0,9487 (scipy `spearmanr`) · 2×2 ki-kare kapalı formül
//    N(ad−bc)²/(r₁r₂c₁c₂) · iki oran z = 2,1909 / p = 0,0285 (statsmodels `proportions_ztest`) ·
//    BH (statsmodels `multipletests fdr_bh`) · n < 30 ve beklenen < 5 uyarıları.
// §3 planlayıcı (DB'siz): maruziyetsiz sayım 400 `ANALIZ_MARUZIYET_GEREKLI`; tanım doğrulaması aynı yol.
// §4 fikstür (DB, `fixture-analiz.ts`): gece çözgü oranı ≈ 2,07 katı → beklenen oranlar + "güçlü kanıt";
//    9 kayıtlık pencerede kanıt cümlesi YOK, örneklem uyarısı VAR; vardiya × hata grubu tablosu kapalı
//    formülle; PG `corr` = JS `pearson`; kişi adı boyutu sunumu buluttan düşürür; kayıtlı rapor bloğu.
//    Üretilen her cümle yasak sözcük listesinden geçer.
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı):
//   t-CDF serbestlik derecesi +1 → 6 ❌ · maruziyet denetimi kaldırıldı → 3 ❌ · örneklem eşiği
//   (`korelasyon()` uyarıyı yok sayar) → 1 ❌ (+ test_rapor_anlati 1 ❌) · `kisiAdi` aktarımı silindi
//   → 1 ❌ · anlatıya "p < 0,01" girdi → 2 ❌ (+ test_rapor_anlati 3 ❌).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ANALYSIS_RANGE, DAYS, DEFECTS, SMALL_RANGE, dayQty, nightQty, setupAnalysisFixture, teardownAnalysisFixture } from "./lib/fixture-analiz";
import { chiSquareCdf, chiSquareSurvival, studentTCdf, studentTTwoSided } from "../src/services/reports/anlati/istatistik/dagilim";
import { averageRanks, pearson, spearman, trendLine } from "../src/services/reports/anlati/istatistik/korelasyon";
import { chiSquareTest, rateGoodnessOfFit } from "../src/services/reports/anlati/istatistik/kikare";
import { rateRatioTest, twoProportionTest } from "../src/services/reports/anlati/istatistik/oran-testi";
import { benjaminiHochberg } from "../src/services/reports/anlati/istatistik/bh";
import { MIN_SAMPLE } from "../src/services/reports/anlati/istatistik/tipler";
import { yasakSozcukBul } from "../src/services/reports/anlati/yasak-sozcuk";
import { CAUSALITY_NOTE } from "../src/services/reports/anlati/kurallar";
import { EXPOSURE_REQUIRED_CODE, analysisSpecSchema, isAnalysisIssue, planAnalysis } from "../src/services/reports/semantik/analiz-plan";
import { runAnalysis, type AnalysisResult } from "../src/services/reports/semantik/analiz";
import { SEMANTIC_CUBES } from "../src/services/reports/semantik/katalog";
import { checkReportDefinition } from "../src/services/reports/semantik/rapor-tanimi.schema";
import { resolveParams, runDefinitionBlocks } from "../src/services/reports/semantik/definition-run";
import { ResultCache } from "../src/services/reports/semantik/onbellek";
import { ReportSemaphore } from "../src/services/reports/semantik/semafor";
import type { RunDeps } from "../src/services/reports/semantik/calistirici";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import { MODULE_SETTING_KEY_BY_FLAG } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const r4 = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
const near = (label: string, got: number | null | undefined, want: number): void => check(label, r4(got) === r4(want), `beklenen ${r4(want)}, gelen ${r4(got)}`);

// --- §1 dağılımlar ------------------------------------------------------------------------
console.log("\n§1 dağılımlar (ders kitabı tabloları, dört hane)");
near("§1 t₁₀ P(T ≤ 2,0) = 0,9633", studentTCdf(2.0, 10), 0.9633);
near("§1 t₁₀ iki yönlü 2,228 → 0,05", studentTTwoSided(2.228, 10), 0.05);
near("§1 t₁₀ P(T ≤ −1,812) = 0,05", studentTCdf(-1.812, 10), 0.05);
near("§1 Cauchy t₁ P(T ≤ 1) = 0,75", studentTCdf(1, 1), 0.75);
near("§1 t₃₀ iki yönlü 2,042 → 0,05", studentTTwoSided(2.042, 30), 0.05);
near("§1 χ²₁ 3,841 → 0,05", chiSquareSurvival(3.841, 1), 0.05);
near("§1 χ²₁ 6,635 → 0,01", chiSquareSurvival(6.635, 1), 0.01);
near("§1 χ²₄ 9,488 → 0,05", chiSquareSurvival(9.488, 4), 0.05);
near("§1 χ²₅ 11,07 → 0,05", chiSquareSurvival(11.07, 5), 0.05);
near("§1 χ²₂ CDF(2) = 1 − e⁻¹", chiSquareCdf(2, 2), 1 - Math.exp(-1));
near("§1 χ²₁₀ 18,307 → 0,05 (seri/kesir sınırı)", chiSquareSurvival(18.307, 10), 0.05);
check("§1 tanımsız girdi NaN (sessiz 0/1 yok)", Number.isNaN(studentTCdf(1, 0)) && Number.isNaN(chiSquareSurvival(1, -1)) && Number.isNaN(chiSquareSurvival(NaN, 2)));

// --- §2 testler ---------------------------------------------------------------------------
console.log("\n§2 testler (Anscombe, ders kitabı ki-kare, oran testi, BH)");
const ax = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const anscombe: Array<[number[], number[]]> = [
  [ax, [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]],
  [ax, [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74]],
  [ax, [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]],
  [[8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8], [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89]],
];
anscombe.forEach(([x, y], i) => check(`§2 Anscombe ${i + 1}: r = 0,816`, Math.trunc(pearson(x, y).istatistik * 1000) === 816, String(r4(pearson(x, y).istatistik))));
const a1 = pearson(anscombe[0]![0], anscombe[0]![1]);
near("§2 Anscombe I r = 0,8164", a1.istatistik, 0.8164);
near("§2 Anscombe I p = 0,0022 (scipy pearsonr 0,00217)", a1.p, 0.0022);
// R3-ANALIZ: saçılım eğilim çizgisi — Anscombe I en küçük kareler y = 3,0001 + 0,5001·x (Anscombe 1973).
const tl = trendLine(anscombe[0]![0], anscombe[0]![1]);
near("§2 eğilim çizgisi sol uç (x 4) y = 5,0005", tl?.[0][1], 3.000090909 + 0.500090909 * 4);
near("§2 eğilim çizgisi sağ uç (x 14) y = 10,0014", tl?.[1][1], 3.000090909 + 0.500090909 * 14);
check("§2 eğilim çizgisi tek x değerinde yok", trendLine([1, 1, 1], [1, 2, 3]) === null);
check("§2 Anscombe I df = 9, n = 11 → örneklem uyarısı (n < 30)", a1.df === 9 && a1.n === 11 && a1.uyarilar.includes("azOrnek"));
check("§2 eşitlikte ortalama sıra [1,2,2,3] → [1; 2,5; 2,5; 4]", JSON.stringify(averageRanks([1, 2, 2, 3])) === "[1,2.5,2.5,4]");
near("§2 eşitlikli Spearman = 0,9487 (scipy spearmanr)", spearman([1, 2, 2, 3], [1, 3, 2, 4]).istatistik, 0.9487);
near("§2 Spearman tekdüze dönüşüme duyarsız (x³) = 1", spearman([1, 2, 3, 4, 5], [1, 8, 27, 64, 125]).istatistik, 1);
check("§2 sabit seri → r ölçülemedi (NaN)", Number.isNaN(pearson([2, 2, 2, 2], [1, 2, 3, 4]).istatistik));
const tb: [[number, number], [number, number]] = [[10, 20], [30, 40]];
const closed = (100 * (10 * 40 - 20 * 30) ** 2) / (30 * 70 * 40 * 60);
const ct = chiSquareTest(tb);
near("§2 2×2 ki-kare = kapalı formül (0,7937)", ct.istatistik, closed);
near("§2 2×2 olasılık = 0,3730 (scipy chi2_contingency correction=False)", ct.p, 0.373);
check("§2 2×2 df = 1", ct.df === 1);
const small = chiSquareTest([[3, 1], [1, 3]]);
check("§2 beklenen hücre < 5 → uyarı", small.uyarilar.includes("kucukBeklenen") && small.uyarilar.includes("azOrnek"), JSON.stringify(small.uyarilar));
const big = chiSquareTest([[30, 20], [60, 20]]);
check("§2 n ≥ 30 ve beklenen ≥ 5 → uyarı yok", big.uyarilar.length === 0, JSON.stringify(big.uyarilar));
const tp = twoProportionTest(45, 100, 30, 100);
near("§2 iki oran z = 2,1909 (statsmodels)", tp.istatistik, 2.1909);
near("§2 iki oran p = 0,0285 (statsmodels)", tp.p, 0.0285);
const rr = rateRatioTest(60, 10000, 30, 10000);
near("§2 maruziyetli oran: 60/10.000 m vs 30/10.000 m → olasılık 0,0016 (χ²₁ = 10)", rr.p, chiSquareSurvival(10, 1));
near("§2 oran oranı = 2", rr.etkiBuyuklugu, 2);
const gof = rateGoodnessOfFit([60, 30], [10000, 10000]);
near("§2 uyum testi (iki grup) = oran testiyle aynı (χ² = 10)", gof.istatistik, 10);
check("§2 BH (statsmodels fdr_bh) [0,01 0,04 0,03 0,005] → [0,02 0,04 0,04 0,02]", JSON.stringify(benjaminiHochberg([0.01, 0.04, 0.03, 0.005]).map(r4)) === "[0.02,0.04,0.04,0.02]", JSON.stringify(benjaminiHochberg([0.01, 0.04, 0.03, 0.005])));
check("§2 BH NaN girdiyi sıralamaya katmaz", JSON.stringify(benjaminiHochberg([0.01, NaN, 0.02]).map(r4)) === "[0.02,null,0.02]");
check("§2 örneklem eşiği 30", MIN_SAMPLE === 30);

// --- §3 planlayıcı ------------------------------------------------------------------------
console.log("\n§3 planlayıcı (maruziyet kuralı)");
const spec = (o: Record<string, unknown>) => analysisSpecSchema.parse({ suzgec: [], ...o });
const noExp = planAnalysis(spec({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi" }), SEMANTIC_CUBES);
check("§3 maruziyetsiz sayım REDDEDİLİR (ANALIZ_MARUZIYET_GEREKLI)", isAnalysisIssue(noExp) && noExp.kod === EXPOSURE_REQUIRED_CODE && noExp.alan === "maruziyet", JSON.stringify(noExp).slice(0, 160));
check("§3 ret mesajı Türkçe ve günlük dilde", isAnalysisIssue(noExp) && /üretim miktarına bölünmeden karşılaştırılamaz/.test(noExp.mesaj));
const withExp = planAnalysis(spec({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre" }), SEMANTIC_CUBES);
check("§3 maruziyetli sayım → oran planı, maruziyet başka küpten (uretim)", !isAnalysisIssue(withExp) && withExp.kind === "rate" && withExp.exposure.cube.id === "uretim", isAnalysisIssue(withExp) ? withExp.mesaj : withExp.kind);
const ratioY = planAnalysis(spec({ yontem: "kiKare", x: "kumas", y: "kalite.birinciYuzde", maruziyet: "kalite.bitenMetre" }), SEMANTIC_CUBES);
check("§3 sayım olmayan ölçüyle grup kıyası reddedilir", isAnalysisIssue(ratioY) && ratioY.alan === "y");
const tableOk = planAnalysis(spec({ yontem: "kiKare", x: "vardiya", y: "hataGrubu" }), SEMANTIC_CUBES);
check("§3 iki boyut → çapraz tablo (maruziyet gerekmez)", !isAnalysisIssue(tableOk) && tableOk.kind === "table");
const corrCount = planAnalysis(spec({ yontem: "pearson", kup: "istasyon", x: "uretim.gecenMetre", y: "uretim.gecenTop", kirilim: "gun" }), SEMANTIC_CUBES);
check("§3 iki ölçü kıyasında sayım ölçüsü de maruziyet ister", isAnalysisIssue(corrCount) && corrCount.kod === EXPOSURE_REQUIRED_CODE);
const defBody = (block: Record<string, unknown>) => ({ surum: 1, baslik: "Analiz", parametreler: [{ ad: "donem", tur: "tarihAraligi" }], bloklar: [{ id: "a1", tur: "analiz", zaman: { param: "donem" }, ...block }] });
const defBad = checkReportDefinition(defBody({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi" }));
check("§3 tanım doğrulaması aynı kuralı uygular (bloklar[0].maruziyet)", !defBad.gecerli && defBad.hatalar.some((h) => h.yol === "bloklar[0].maruziyet"), JSON.stringify(defBad.hatalar));
const defOk = checkReportDefinition(defBody({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: { combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }] } }));
check("§3 geçerli analiz bloğu kabul + izinleri toplanır", defOk.gecerli && defOk.gerekenIzinler.includes("report:quality"), JSON.stringify(defOk.hatalar));
const defField = checkReportDefinition(defBody({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: { combinator: "and", rules: [{ field: "yok", operator: "=", value: "X" }] } }));
check("§3 analiz süzgecinde bilinmeyen boyut reddedilir", !defField.gecerli);

// --- §4 fikstür ---------------------------------------------------------------------------
let CTX: AccessContext = { userId: "", permissions: ["*"], openModuleKeys: new Set(Object.values(MODULE_SETTING_KEY_BY_FLAG)) };
const deps = (): RunDeps => ({ cubes: SEMANTIC_CUBES, semaphore: new ReportSemaphore(), cache: new ResultCache(), readTimeoutSec: async () => 15 });
const COZGU = [{ alan: "hataGrubu", islec: "=", deger: "COZGU" }];
const analyse = (o: Record<string, unknown>): Promise<AnalysisResult> => runAnalysis(spec(o), CTX, { deps: deps() });
const sentences: string[] = [];
const texts = (r: AnalysisResult): string[] => {
  const t = r.sunum.anlati.map((a) => a.metin);
  sentences.push(...t);
  return t;
};

async function fixtureSections(): Promise<void> {
  console.log("\n§4 fikstür: gece çözgü hatası (dolu veri, Mayıs 2097)");
  const sum = (f: (d: number) => number): number => Array.from({ length: DAYS }, (_, i) => f(i + 1)).reduce((a, b) => a + b, 0);
  const eDay = sum(dayQty);
  const eNight = sum(nightQty);
  const rDay = (DEFECTS.day.COZGU / eDay) * 1000;
  const rNight = (DEFECTS.night.COZGU / eNight) * 1000;
  const r = await analyse({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: COZGU, ...ANALYSIS_RANGE });
  const g = new Map((r.istatistik?.gruplar ?? []).map((x) => [x.ad, x]));
  near("§4 gece oranı (1000 m'de) = 60 / gece metresi", g.get("Gece")?.oran, rNight);
  near("§4 gündüz oranı (1000 m'de) = 30 / gündüz metresi", g.get("Gündüz")?.oran, rDay);
  check("§4 maruziyet = fikstür metresi (gece/gündüz)", g.get("Gece")?.maruziyet === eNight && g.get("Gündüz")?.maruziyet === eDay, `${g.get("Gece")?.maruziyet}/${g.get("Gündüz")?.maruziyet}`);
  near("§4 kat = gece / gündüz", r.istatistik?.etkiBuyuklugu, rNight / rDay);
  const n = DEFECTS.day.COZGU + DEFECTS.night.COZGU;
  const expD = (n * eDay) / (eDay + eNight);
  const expN = n - expD;
  const hand = (DEFECTS.day.COZGU - expD) ** 2 / expD + (DEFECTS.night.COZGU - expN) ** 2 / expN;
  near("§4 uyum istatistiği = elle Σ(O−E)²/E", r.istatistik?.istatistik, hand);
  check("§4 n = 90 ≥ 30 → uyarı yok", r.istatistik?.n === n && r.istatistik.uyarilar.length === 0, JSON.stringify(r.istatistik?.uyarilar));
  const t = texts(r);
  const want = `Gece vardiyasında bulunan hata 1.000 m'de ${(Math.round(rNight * 10) / 10).toString().replace(".", ",")}; diğerlerinde ${(Math.round(rDay * 10) / 10).toString().replace(".", ",")} — yaklaşık ${(Math.round((rNight / rDay) * 10) / 10).toString().replace(".", ",")} katı. Bu fark tesadüf olmayacak kadar büyük (güçlü kanıt; 90 kayıt üzerinden ölçüldü). ${CAUSALITY_NOTE}`;
  check("§4 anlatı: bilinen ilişki günlük dilde", t[0] === want, `gelen ${JSON.stringify(t)}`);
  check("§4 grafik: çubuk, iki vardiya", r.sunum.grafik?.tur === "cubuk" && r.sunum.grafik.kategoriler.length === 2);
  check("§4 vardiya sunumu kişi adı taşımaz", r.sunum.kisiAdi === undefined);

  console.log("\n§4b küçük örneklem (Temmuz 2097, 9 kayıt)");
  const s = await analyse({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: COZGU, ...SMALL_RANGE });
  const st = texts(s);
  check("§4b 9 kayıt → örneklem uyarısı", s.istatistik?.n === 9 && !!s.istatistik.uyarilar.includes("azOrnek"));
  check("§4b kanıt cümlesi KURULMAZ, yalnız uyarı", st.length === 1 && st[0] === `Yalnız 9 kayıt var; karar vermek için en az 30 gerekir. ${CAUSALITY_NOTE}` && s.sunum.anlati[0]?.kural === "orneklemUyarisi", JSON.stringify(st));

  console.log("\n§4c vardiya × hata grubu çapraz tablo");
  const tb2 = await analyse({ yontem: "kiKare", x: "vardiya", y: "hataGrubu", ...ANALYSIS_RANGE });
  const [a, b, c, d] = [DEFECTS.night.ATKI, DEFECTS.night.COZGU, DEFECTS.day.ATKI, DEFECTS.day.COZGU];
  const N = a + b + c + d;
  near("§4c ki-kare = kapalı formül", tb2.istatistik?.istatistik, (N * (a * d - b * c) ** 2) / ((a + b) * (c + d) * (a + c) * (b + d)));
  check("§4c grafik ısı haritası (satır payı %)", tb2.sunum.grafik?.tur === "isiHaritasi" && tb2.sunum.grafik.eksen.y.birim === "yuzde");
  check("§4c anlatı nedensellik notuyla biter", texts(tb2).every((m) => m.endsWith(CAUSALITY_NOTE)));

  console.log("\n§4d iki ölçü: PG corr = JS pearson");
  const pc = await analyse({ yontem: "pearson", x: "kalite.bitenMetre", y: "kalite.birinciMetre", kirilim: "gun", ...ANALYSIS_RANGE });
  const pts = (pc.sunum.tablo?.satirlar ?? []).map((row) => [Number(row.x), Number(row.y)] as const);
  const [pg] = await prisma.$queryRaw<{ r: number; r2: number; n: bigint }[]>`
    SELECT corr(x, y) AS r, regr_r2(y, x) AS r2, regr_count(y, x) AS n
    FROM unnest(${pts.map((p) => p[0])}::float8[], ${pts.map((p) => p[1])}::float8[]) AS t(x, y)`;
  check("§4d günlük nokta sayısı = fikstür günü", pts.length === DAYS, String(pts.length));
  near("§4d PG corr = JS pearson", pc.istatistik?.istatistik, Number(pg!.r));
  near("§4d PG regr_r2 = r²", (pc.istatistik?.istatistik ?? NaN) ** 2, Number(pg!.r2));
  check("§4d 10 gün → kanıt yok, uyarı var", texts(pc)[0] === `Yalnız 10 gün var; karar vermek için en az 30 gerekir. ${CAUSALITY_NOTE}`, JSON.stringify(pc.sunum.anlati.map((x) => x.metin)));
  check("§4d grafik saçılım", pc.sunum.grafik?.tur === "sacilim" && pc.sunum.grafik.kategoriler.length === DAYS);

  console.log("\n§4e maruziyet reddi + kişi adı (K-KISI)");
  let code: unknown = null;
  try {
    await analyse({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", ...ANALYSIS_RANGE });
  } catch (e) {
    code = e instanceof AppError && e.statusCode === 400 ? (e.details as { code?: string } | undefined)?.code : e;
  }
  check("§4e maruziyetsiz sayım → 400 ANALIZ_MARUZIYET_GEREKLI (sorgu koşmadan)", code === EXPOSURE_REQUIRED_CODE, String(code));
  const op = await analyse({ yontem: "kiKare", x: "operator", y: "istasyon", ...ANALYSIS_RANGE });
  check("§4e operatör boyutu → sunum.kisiAdi (bulut dışı)", op.sunum.kisiAdi === true);

  console.log("\n§4f kayıtlı rapor analiz bloğu");
  const body = defBody({ yontem: "kiKare", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: { combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }] } });
  const chk = checkReportDefinition(body);
  if (!chk.gecerli) {
    check("§4f tanım geçerli", false, JSON.stringify(chk.hatalar));
    return;
  }
  const params = resolveParams(chk.govde, { donem: { baslangic: ANALYSIS_RANGE.dateFrom, bitis: ANALYSIS_RANGE.dateTo } });
  const [blk] = await runDefinitionBlocks(chk.govde, params, CTX, { origin: null, refresh: true });
  check("§4f analiz bloğu artık hesaplanıyor (desteklenmiyor değil)", blk?.durum === "tamam" && !!blk.analiz, JSON.stringify(blk).slice(0, 200));
  if (blk?.durum === "tamam") check("§4f blok anlatısı önizlemeyle aynı", blk.analiz?.sunum.anlati[0]?.metin === r.sunum.anlati[0]?.metin, blk.analiz?.sunum.anlati[0]?.metin);

  console.log("\n§4g özel rapor \"Ne görüyoruz?\" bloğu (R2-ANLATI) — analizden ÖNCE dursa da girdisini alır");
  const withNarrative = { ...body, bloklar: [{ id: "n1", tur: "anlati", kurallar: ["korelasyon", "orneklemUyarisi"], enFazla: 2 }, ...body.bloklar] };
  const chkN = checkReportDefinition(withNarrative);
  if (!chkN.gecerli) {
    check("§4g tanım geçerli", false, JSON.stringify(chkN.hatalar));
    return;
  }
  const [nb, ab] = await runDefinitionBlocks(chkN.govde, params, CTX, { origin: null, refresh: true });
  const expected = ab?.durum === "tamam" ? ab.analiz?.sunum.anlati.find((c) => c.kural === "korelasyon")?.metin : undefined;
  const got = nb?.durum === "tamam" ? nb.anlati ?? [] : [];
  check("§4g blok sırası korunur (anlatı ilk, analiz ikinci)", nb?.tur === "anlati" && ab?.tur === "analiz");
  check("§4g anlatı cümlesi sunucuda, analiz kanıtıyla aynı metin", !!expected && got[0]?.metin === expected, `${got[0]?.metin} ≠ ${expected}`);
  sentences.push(...got.map((c) => c.metin));
  const deniedCtx: AccessContext = { ...CTX, permissions: [] };
  const [nd, ad] = await runDefinitionBlocks(chkN.govde, params, deniedCtx, { origin: null, refresh: true });
  check("§4g yetkisiz analiz bloğu anlatıya girdi vermez", ad?.durum === "yetkisiz" && nd?.durum === "tamam" && (nd.anlati ?? []).length === 0, JSON.stringify(nd).slice(0, 200));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  try {
    const fx = await setupAnalysisFixture();
    CTX = { ...CTX, userId: fx.operatorId };
    await fixtureSections();
  } finally {
    await teardownAnalysisFixture();
  }
  console.log("\n§5 yasak sözcük (üretilen her analiz cümlesi)");
  const dirty = sentences.filter((m) => yasakSozcukBul(m).length > 0);
  check("§5 analiz cümlelerinde formül dili yok (p, korelasyon, katsayı…)", sentences.length >= 4 && dirty.length === 0, dirty.join(" | ") || `${sentences.length} cümle`);
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
