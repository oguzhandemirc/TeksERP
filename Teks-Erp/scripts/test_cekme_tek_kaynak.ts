// =============================================================================
// BOY ÇEKMESİ TEK KAYNAK BEKÇİSİ (Seyitoğlu temel, 2026-11-11) — DB'siz metin taraması
// =============================================================================
// "Bu kumaşın boy çekmesi ne?" önceliğini (ürün yapısı → terbiye tarifesi → yok) YALNIZ
// `resolveLengthShrinkPct` kurar; "mamul kaç ham metre" formülünü YALNIZ `rawMetersFromFinished`.
//   §1 `typicalShrinkPct` okuyan her src dosyası ya beyanlı CRUD/doğrulama yüzeyidir ya da çözücüyü çağırır
//   §2 çözücü dışında `lengthShrinkPct ?? … typicalShrinkPct` (ya da tersi) yedek zinciri kurulmaz
//   §3 bilinen tüketiciler (maliyet girdisi, üretim önerisi, iplik ihtiyacı, üretim dengesi I3) tek kaynağı çağırır
//
// NEGATİF SONDA — 2026-11-11 koşuldu (cp + geri alma):
//   cost-assembler'da çözücü yerine `cs?.lengthShrinkPct ?? src.rates.get(…)?.typicalShrinkPct` → §1 + §2 ❌
//   yarn-need'de `rawMetersFromFinished` yerine `d.meters` → §3 ❌
//   (I3, 2026-11-12) production-balance'ta `materialGapFinishedM(` çağrısı kaldırılınca → §3 ❌
// Koşum: npx tsx scripts/test_cekme_tek_kaynak.ts
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const RESOLVER = "src/services/helpers/raw-need.helper.ts";

/** Tarifenin tipik çekmesini yalnız saklayan/doğrulayan yüzeyler (öncelik kurmazlar). */
const CRUD_EXEMPT: Record<string, string> = {
  "src/services/finishing-rate.service.ts": "tarife CRUD: alanı yazar/okur, çekme önceliği kurmaz",
  "src/routes/cost.routes.ts": "tarife gövdesinin Zod şeması",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
/** Yorum satırlarını at (beyan metni sayılmaz). */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const files = walk(SRC).map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), text: code(readFileSync(p, "utf8")) }));

// §1
const readers = files.filter((f) => f.text.includes("typicalShrinkPct") && f.rel !== RESOLVER);
const offenders = readers.filter((f) => !CRUD_EXEMPT[f.rel] && !f.text.includes("resolveLengthShrinkPct("));
check("§1 `typicalShrinkPct` okuyan her dosya beyanlı CRUD ya da `resolveLengthShrinkPct` çağırır", offenders.length === 0, offenders.map((f) => f.rel).join(", "));
const deadExempt = Object.keys(CRUD_EXEMPT).filter((k) => !readers.some((f) => f.rel === k));
check("§1b muaf listesi canlı (iki yönlü: listedeki her dosya hâlâ alanı okuyor)", deadExempt.length === 0, deadExempt.join(", "));

// §2
const chain = /lengthShrinkPct[^;\n]{0,120}\?\?[^;\n]{0,120}typicalShrinkPct|typicalShrinkPct[^;\n]{0,120}\?\?[^;\n]{0,120}lengthShrinkPct/;
const chains = files.filter((f) => f.rel !== RESOLVER && chain.test(f.text));
check("§2 çözücü dışında yapı ↔ tarife çekme yedek zinciri yok", chains.length === 0, chains.map((f) => f.rel).join(", "));

// §3
const must: Array<[string, string]> = [
  ["src/services/helpers/cost-assembler.helper.ts", "resolveLengthShrinkPct("],
  ["src/services/helpers/production-proposal.helper.ts", "resolveLengthShrinkPct("],
  ["src/services/helpers/production-proposal.helper.ts", "rawMetersFromFinished("],
  ["src/services/reports/yarn-need.report.service.ts", "rawMetersFromFinished("],
  ["src/services/production-balance.service.ts", "resolveLengthShrinkPct("],
  ["src/services/production-balance.service.ts", "materialGapFinishedM("],
];
const missing = must.filter(([rel, sym]) => !files.find((f) => f.rel === rel)?.text.includes(sym));
check("§3 maliyet girdisi · üretim önerisi · iplik ihtiyacı · üretim dengesi (kumaş açığı) tek kaynağı çağırır", missing.length === 0, missing.map(([r, s]) => `${r} → ${s}`).join(", "));
const resolver = files.find((f) => f.rel === RESOLVER)?.text ?? "";
check("§3b çözücü dosyası iki tek kaynağı da dışa verir", /export function resolveLengthShrinkPct\(/.test(resolver) && /export function rawMetersFromFinished\(/.test(resolver));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
