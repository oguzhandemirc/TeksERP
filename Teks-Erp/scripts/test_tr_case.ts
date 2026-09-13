// =============================================================================
// test_tr_case — Türkçe harf katlaması TEK KAYNAK: i/İ sondası + içe aktarım simetrisi
// =============================================================================
// Koşum: npx tsx scripts/test_tr_case.ts   (DB'siz)
//
// §1 i/İ ORACLE — beklentiler DÜZ DİZE (helper'a değil, Türk alfabesine göre):
//    "iplik" ↔ "İPLİK", "ışık" ↔ "IŞIK". `toUpperCase()` (ASCII/Unicode
//    varsayılanı) "iplik" → "IPLIK" üretir; helper bunu üretirse KIRMIZI.
//    Negatif sonda: tr-case.ts'te `toLocaleUpperCase(TR_LOCALE)` → `toUpperCase()`.
// §2 SİMETRİ — içe aktarımda YAZAN (`import.service.ts` anahtar katlaması) ile
//    OKUYAN (16 adaptörün kod haritası) aynı helper'ı çağırır; biri `toUpperCase()`
//    ya da ham `toLocaleUpperCase` ile ayrışırsa bugün olmayan bir kusur doğar
//    ("İPLİK" anahtarı "IPLIK" ile aranır) ve yalnız bu sonda görür.
//    Negatif sonda: bir adaptörde `upperTr(r.code)` → `r.code.toUpperCase()`.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lowerTr, upperTr } from "../src/utils/tr-case";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

// --- §1 -----------------------------------------------------------------------
const oracle: Array<[string, string, string]> = [
  // [girdi, upperTr beklenen, lowerTr beklenen]
  ["iplik", "İPLİK", "iplik"],
  ["İPLİK", "İPLİK", "iplik"],
  ["ışık", "IŞIK", "ışık"],
  ["IŞIK", "IŞIK", "ışık"],
  ["Öz Şahin Tekstil", "ÖZ ŞAHİN TEKSTİL", "öz şahin tekstil"],
  ["çğıöşü", "ÇĞIÖŞÜ", "çğıöşü"],
];
for (const [inp, up, low] of oracle) {
  check(`§1 upperTr(${JSON.stringify(inp)}) = ${JSON.stringify(up)}`, upperTr(inp) === up, `got=${upperTr(inp)}`);
  check(`§1 lowerTr(${JSON.stringify(inp)}) = ${JSON.stringify(low)}`, lowerTr(inp) === low, `got=${lowerTr(inp)}`);
}
check("§1 i/İ gidiş-dönüş: lowerTr(upperTr('iplik')) = 'iplik'", lowerTr(upperTr("iplik")) === "iplik");
check("§1 ı/I gidiş-dönüş: upperTr(lowerTr('IŞIK')) = 'IŞIK'", upperTr(lowerTr("IŞIK")) === "IŞIK");
// KOD tuzağının belgesi: helper kod için DEĞİL — "sip" ile "SIP" eşleşmez.
check("§1 kod tuzağı belgelendi: upperTr('sip') = 'SİP' ≠ 'SIP'", upperTr("sip") === "SİP" && upperTr("sip") !== "SIP");

// --- §2 -----------------------------------------------------------------------
const ROOT = join(__dirname, "..", "src", "services", "import");
const writer = readFileSync(join(ROOT, "import.service.ts"), "utf8");
check("§2 yazan (import.service) upperTr ile katlıyor", /upperTr\(key\)/.test(writer) && /from "\.\.\/\.\.\/utils\/tr-case"/.test(writer));
check("§2 yazan'da ham toLocale*Case yok", !/toLocale(Upper|Lower)Case\(/.test(writer.replace(/\/\/.*$/gm, "")));

const adapterDir = join(ROOT, "adapters");
const adapters = readdirSync(adapterDir).filter((f) => f.endsWith(".adapter.ts"));
let okuyan = 0;
for (const f of adapters) {
  const src = readFileSync(join(adapterDir, f), "utf8").replace(/\/\/.*$/gm, "");
  const foldsCode = /\.code\b[^;\n]*\)/.test(src) && /upperTr\(/.test(src);
  const rawFold = /toLocale(Upper|Lower)Case\(/.test(src);
  // Harita ANAHTARI üzerinde `toUpperCase()` YASAK — yazanla ayrışır. (fabric-property'nin
  // `c.trim().toUpperCase()`ı özellik DEĞERİ kodunu ayrıştırır, harita anahtarı değil — eskiden "en-US".)
  const asciiOnKey = /\b(\w+\.code|customerCode|targetCode|raw|key|keyValue)(\s*\?\?\s*"")?\)?\.toUpperCase\(\)/.test(src);
  if (foldsCode) okuyan++;
  check(`§2 okuyan ${f}: ham toLocale yok · anahtarda toUpperCase yok`, !rawFold && !asciiOnKey);
}
check("§2 kod haritası kuran adaptör sayısı ≥ 14 (yazan↔okuyan çifti var)", okuyan >= 14, `okuyan=${okuyan}`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
