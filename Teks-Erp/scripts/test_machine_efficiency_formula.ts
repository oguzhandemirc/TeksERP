// =============================================================================
// Randıman formülü bekçisi — `helpers/loom-efficiency.helper.ts` (DB'siz, saf + AST)
// =============================================================================
// Koşum: npx tsx scripts/test_machine_efficiency_formula.ts
//
// Ölçer (rapor sözleşmesi ①, DOKUMA-TEZGAH §5.2):
//   §1 tek hedefli vardiyada E = A × P BİREBİR (aynı hedef, aynı pencere) — üç oran
//      AYRI döner, çarpılarak üretilmez
//   §2 payda 0 → `null` ("ölçülemedi" BEYANI, 0 değil), `olculemedi` gerekçesi adıyla
//   §3 P > 100 → uyarı; değer DÜZELTİLMEZ (veri hatası sinyali)
//   §4 toplam Σpay/Σpayda — ORTALAMA DEĞİL; paydası sıfır satır dışlanır ve sayılır
//   §5 AST tripwire: `/ potSec|aptSec|targetPickCapacity*` bölmesi helper dışında YOK ·
//      `…Pct ?? 0` null-çökertmesi YOK · `avg(…Pct)` YOK — tarayıcının kendisi sentetik
//      metinle ölçülür (körlük zemini)
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · `toPct(netPicks / t.targetPickCapacityApt)`nin bölmesi `machine-shift-stat.service.ts`e
//     kopyalanınca §5a ❌ · helper'da `?? 0` çökertmesi eklenince §2a ❌
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { aggregateMachineKpis, computeMachineKpis } from "../src/services/helpers/loom-efficiency.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const KOK = join(__dirname, "..");
const HELPER = "src/services/helpers/loom-efficiency.helper.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const ad of readdirSync(dir)) {
    const p = join(dir, ad);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (ad.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Tripwire desenleri — TEK yerde; §5k sentetik metinle "desen hâlâ eşleşiyor mu" ölçer. */
export const BOLME_DESENI = /\/\s*(?:[\w$]+\.)*(potSec|aptSec|targetPickCapacity\w*)\b/;
export const COKERTME_DESENI = /(availabilityPct|performancePct|effectivenessPct)\s*\?\?\s*0\b/;
export const ORTALAMA_DESENI = /\bavg\s*\(\s*[^)]*Pct/i;

function main(): void {
  console.log("\n=== Randıman formülü — E = A×P, payda 0 → null, Σ değil ortalama, AST tripwire ===\n");

  // ── §1 tek hedef: E = A × P birebir ──────────────────────────────────────
  const pot = 28_800, apt = 25_200, target = 600, picks = 200_000;
  const t1 = { potSec: pot, aptSec: apt, picksActual: picks, gapPicks: 0, targetPickCapacityApt: (target * apt) / 60, targetPickCapacityPot: (target * pot) / 60 };
  const k1 = computeMachineKpis(t1);
  check("§1a A = APT/POT (%87.5)", k1.availabilityPct === 87.5, String(k1.availabilityPct));
  check("§1b P = picks/capApt (%79.37)", k1.performancePct === 79.37, String(k1.performancePct));
  check("§1c E = picks/capPot (%69.44)", k1.effectivenessPct === 69.44, String(k1.effectivenessPct));
  const axp = (k1.availabilityPct! * k1.performancePct!) / 100;
  check("§1d ⭐ E ≡ A × P (tek hedefte birebir, yuvarlama payı ≤ 0.02)", Math.abs(k1.effectivenessPct! - axp) <= 0.02, `${k1.effectivenessPct} ↔ ${axp.toFixed(2)}`);
  check("§1e formulaVersion 1, uyarı yok", k1.formulaVersion === 1 && k1.warnings.length === 0 && Object.keys(k1.olculemedi).length === 0);

  // ── §2 payda 0 → null ─────────────────────────────────────────────────────
  const k2 = computeMachineKpis({ potSec: 0, aptSec: 0, picksActual: 100, gapPicks: 0, targetPickCapacityApt: 0, targetPickCapacityPot: 0 });
  check("§2a ⭐ POT 0 → A null (0 değil)", k2.availabilityPct === null && typeof k2.olculemedi.A === "string");
  check("§2b capApt 0 → P null + gerekçe 'hedef devir'", k2.performancePct === null && /hedef devir/.test(k2.olculemedi.P ?? ""));
  check("§2c capPot 0 → E null", k2.effectivenessPct === null && typeof k2.olculemedi.E === "string");
  const k2b = computeMachineKpis({ potSec: 100, aptSec: 50, picksActual: 10, gapPicks: 0, targetPickCapacityApt: 0, targetPickCapacityPot: 0 });
  check("§2d A ölçülür, P/E ölçülemez — karışık", k2b.availabilityPct === 50 && k2b.performancePct === null && k2b.effectivenessPct === null);

  // ── §3 P > 100 → uyarı, düzeltme yok ─────────────────────────────────────
  const k3 = computeMachineKpis({ potSec: 100, aptSec: 100, picksActual: 1500, gapPicks: 0, targetPickCapacityApt: 1000, targetPickCapacityPot: 1000 });
  check("§3a P %150 olduğu gibi basılır (kırpma yok)", k3.performancePct === 150);
  check("§3b ⭐ P > 100 uyarı taşır", k3.warnings.some((w) => /> 100/.test(w)), k3.warnings.join(" | "));

  // ── §4 toplam: Σ/Σ, ortalama değil ────────────────────────────────────────
  const rows = [
    { potSec: 100, aptSec: 50, picksActual: 1000, gapPicks: 0, targetPickCapacityApt: 2000, targetPickCapacityPot: 4000 },
    { potSec: 100, aptSec: 100, picksActual: 100, gapPicks: 0, targetPickCapacityApt: 100, targetPickCapacityPot: 100 },
    { potSec: 0, aptSec: 0, picksActual: 0, gapPicks: 0, targetPickCapacityApt: 0, targetPickCapacityPot: 0 },
  ];
  const agg = aggregateMachineKpis(rows);
  check("§4a ⭐ P toplamı Σpicks/Σcap = 1100/2100 = %52.38 (ortalama olsaydı %75)", agg.performancePct === 52.38, String(agg.performancePct));
  check("§4b A toplamı 150/200 = %75", agg.availabilityPct === 75);
  check("§4c paydası sıfır satır DIŞLANDI ve sayıldı (A:1 P:1 E:1)", agg.olculemedi.A === 1 && agg.olculemedi.P === 1 && agg.olculemedi.E === 1 && agg.rowCount === 3);
  const aggBos = aggregateMachineKpis([rows[2]!]);
  check("§4d hepsi ölçülemezse toplam da null", aggBos.availabilityPct === null && aggBos.performancePct === null && aggBos.effectivenessPct === null);
  const aggGap = aggregateMachineKpis([{ potSec: 100, aptSec: 100, picksActual: 1000, gapPicks: 200, targetPickCapacityApt: 1000, targetPickCapacityPot: 1000 }]);
  check("§4e gapPicks PAYDAN düşer (800/1000)", aggGap.performancePct === 80 && computeMachineKpis({ potSec: 100, aptSec: 100, picksActual: 1000, gapPicks: 200, targetPickCapacityApt: 1000, targetPickCapacityPot: 1000 }).performancePct === 80);

  // ── §5 AST tripwire ───────────────────────────────────────────────────────
  const dosyalar = walk(join(KOK, "src")).map((p) => relative(KOK, p));
  const ihlalBolme: string[] = [];
  const ihlalCokertme: string[] = [];
  const ihlalOrtalama: string[] = [];
  for (const rel of dosyalar) {
    const metin = readFileSync(join(KOK, rel), "utf8");
    const kod = metin.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (rel !== HELPER && BOLME_DESENI.test(kod)) ihlalBolme.push(rel);
    if (COKERTME_DESENI.test(kod)) ihlalCokertme.push(rel);
    if (ORTALAMA_DESENI.test(kod)) ihlalOrtalama.push(rel);
  }
  check("§5a ⭐ POT/APT/kapasite BÖLMESİ yalnız helper'da", ihlalBolme.length === 0, ihlalBolme.join(", "));
  check("§5b `…Pct ?? 0` null-çökertmesi hiçbir yerde", ihlalCokertme.length === 0, ihlalCokertme.join(", "));
  check("§5c `avg(…Pct)` hiçbir yerde", ihlalOrtalama.length === 0, ihlalOrtalama.join(", "));
  const helperKod = readFileSync(join(KOK, HELPER), "utf8");
  check("§5d körlük zemini: helper'ın kendisi bölmeyi TAŞIYOR (desen canlı)", BOLME_DESENI.test(helperKod));
  check("§5e körlük zemini: src taraması ≥ 300 dosya", dosyalar.length >= 300, String(dosyalar.length));
  // Tarayıcının kendisi ölçülür — desen sessizce ölürse §5a "temiz" der.
  check("§5k ⭐ sentetik ihlal: `x / row.potSec` yakalanır", BOLME_DESENI.test("const a = x / row.potSec;"));
  check("§5l ⭐ sentetik ihlal: `picks / t.targetPickCapacityApt` yakalanır", BOLME_DESENI.test("picks / t.targetPickCapacityApt"));
  check("§5m sentetik masum: `x / 60` yakalanmaz", !BOLME_DESENI.test("const a = x / 60;"));
  check("§5n ⭐ sentetik ihlal: `r.performancePct ?? 0` yakalanır", COKERTME_DESENI.test("const p = r.performancePct ?? 0;"));
  check("§5o ⭐ sentetik ihlal: `avg(availabilityPct)` yakalanır", ORTALAMA_DESENI.test("SELECT avg(\"availabilityPct\")"));
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
