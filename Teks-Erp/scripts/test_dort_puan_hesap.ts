// =============================================================================
// BEKÇİ: 4 puan motoru — DB'siz altın tablo (K4P-MOTOR, plan §2)
// Çalıştır: npx tsx scripts/test_dort_puan_hesap.ts
// =============================================================================
// NEDEN: muayene puanı/derecesi müşteriye giden sayıdır; formül, tavan, yuvarlama ya da bant
// kapsayıcılığı sessizce kayarsa "rapor 40,00 diyor ama C" çelişkisi doğar. Motor saf olduğu için
// tek tablo bütün yazarları (muayene, önizleme, rapor) birlikte ölçer.
// Negatif sonda: `round2` ROUND_HALF_UP → ROUND_FLOOR yapılınca §5 (HALF_UP) ve §4 (11,15) kırmızı.
// =============================================================================
import { Prisma } from "@prisma/client";
import {
  applyRunningCap, computeFourPoint, pointsFor, resolveBand, round2, scorePer100M2, toUnit, validateBands, type RuleBand,
} from "../src/services/helpers/four-point.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const d = (points: number, m: string | null) => ({ points, startMeter: m == null ? null : D(m) });

console.log("§1 boyut → puan · sabit puan");
check("≤3\" → 1", pointsFor("UP_TO_3IN", null) === 1);
check("3–6\" → 2", pointsFor("IN_3_TO_6", null) === 2);
check("6–9\" → 3", pointsFor("IN_6_TO_9", null) === 3);
check(">9\" → 4", pointsFor("OVER_9IN", null) === 4);
check("sabit puan boyutu ezer", pointsFor("UP_TO_3IN", 4) === 4 && pointsFor(null, 2) === 2);
check("boyutsuz + sabitsiz → null", pointsFor(null, null) === null);

console.log("§2 koşu tavanı");
check("aynı yardada 3+3 → 4", applyRunningCap([d(3, "9.2"), d(3, "9.9")], "YARD") === 4, "9,2 m ve 9,9 m aynı yarda (kova 10)");
check("farklı yardalarda 3+3 → 6", applyRunningCap([d(3, "0.5"), d(3, "1.0")], "YARD") === 6, "0,5 m kova 0 · 1,0 m kova 1");
check("METER tavanı metre kovasıyla", applyRunningCap([d(4, "2.1"), d(4, "2.9"), d(1, "3.0")], "METER") === 5);
check("NONE tavansız", applyRunningCap([d(3, "10.0"), d(3, "10.5")], "NONE") === 6);
check("metresiz tavansız (aynı tür dört kez 4)", applyRunningCap([d(4, null), d(4, null), d(4, null)], "YARD") === 12);

console.log("§3 en yok → null");
check("en null → skor null", scorePer100M2(20, null, D(100)) === null);
check("en 0 → skor null", scorePer100M2(20, D(0), D(100)) === null);
const noWidth = computeFourPoint([d(4, "1")], null, D(100), { unit: "M2", runningCap: "YARD" });
check("hesap: en yokken pointsPer100M2 ve gradeScore null", noWidth.pointsPer100M2 === null && noWidth.gradeScore === null && noWidth.cappedPoints === 4);

console.log("§4 altın satır: 20 puan · 150 cm · 100 m");
const raw = scorePer100M2(20, D(150), D(100))!;
check("13,33 /100 m²", round2(raw).toFixed(2) === "13.33", raw.toString());
const yd = round2(toUnit(raw, "YD2"));
check("11,15 /100 yd²", yd.toFixed(2) === "11.15", yd.toString());
// ASTM D5430: puan × 36 × 100 / (en_inç × boy_yarda)
const astm = D(20).mul(36).mul(100).div(D(150).div("2.54").mul(D(100).div("0.9144")));
check("ASTM formülüyle özdeş (2 hane)", round2(astm).equals(yd), astm.toFixed(4));
check("ASTM formülüyle özdeş (tam hassasiyet, 1e-12)", astm.minus(toUnit(raw, "YD2")).abs().lt("1e-12"));
const full = computeFourPoint(Array.from({ length: 5 }, (_, i) => d(4, String(i * 2))), D(150), D(100), { unit: "YD2", runningCap: "YARD" });
check("computeFourPoint aynı sayıları verir", full.cappedPoints === 20 && full.pointsPer100M2!.toFixed(2) === "13.33" && full.gradeScore!.toFixed(2) === "11.15");

console.log("§5 ROUND_HALF_UP sınırları");
check("1,005 → 1,01", round2(D("1.005")).toFixed(2) === "1.01");
check("2,675 → 2,68", round2(D("2.675")).toFixed(2) === "2.68");
check("1,0049 → 1,00", round2(D("1.0049")).toFixed(2) === "1.00");
check("1,125 → 1,13 (çift sayıya yuvarlama değil)", round2(D("1.125")).toFixed(2) === "1.13");

console.log("§6 bant kapsayıcılığı");
const bands: RuleBand[] = [
  { sortOrder: 2, maxScore: null, label: "C", accepted: false, qualityGradeId: "g3" },
  { sortOrder: 0, maxScore: D("20.00"), label: "A", accepted: true, qualityGradeId: "g1" },
  { sortOrder: 1, maxScore: D("40.00"), label: "B", accepted: true, qualityGradeId: "g2" },
];
check("tam eşik 20,00 → A (alt bant)", resolveBand(bands, D("20.00"))?.label === "A");
check("20,01 → B", resolveBand(bands, D("20.01"))?.label === "B");
check("40,00 → B", resolveBand(bands, D("40.00"))?.label === "B");
check("40,01 → C (son bant tümü)", resolveBand(bands, D("40.01"))?.label === "C");
check("0 → A", resolveBand(bands, D(0))?.label === "A");

console.log("§7 geçersiz bant setleri");
check("geçerli fabrika seti → hata yok", validateBands(bands, "FACTORY").length === 0);
check("boş set", validateBands([], "FACTORY").length > 0);
check("son bant sınırlı", validateBands([{ ...bands[1]!, maxScore: D(10) }], "FACTORY").length > 0);
check("iki sınırsız bant", validateBands([{ ...bands[0]! }, { ...bands[0]!, sortOrder: 5 }], "FACTORY").length > 0);
check("artmayan sınırlar", validateBands([{ ...bands[1]! }, { ...bands[2]!, maxScore: D("20.00") }, bands[0]!], "FACTORY").length > 0);
check("fabrika setinde derece eksik", validateBands(bands.map((b) => ({ ...b, qualityGradeId: b.label === "B" ? null : b.qualityGradeId })), "FACTORY").length > 0);
check("müşteri setinde derece yasak", validateBands(bands, "CUSTOMER").length > 0);
check("müşteri seti dereceli değilse geçerli", validateBands(bands.map((b) => ({ ...b, qualityGradeId: null })), "CUSTOMER").length === 0);
check("boş etiket", validateBands(bands.map((b) => ({ ...b, label: b.label === "A" ? " " : b.label })), "FACTORY").length > 0);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
