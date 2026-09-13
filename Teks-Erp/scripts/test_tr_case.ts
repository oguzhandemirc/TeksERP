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
// §3 ÜÇ KOPYA BAYT-BAYT — backend · Electron · mobil ayrı projedir, ortak modül
//    import edilemez (search-fold emsali); md5 eşitliği ölçülür. Negatif sonda:
//    bir kopyada bir karakter değiştir → kırmızı.

import { createHash } from "node:crypto";
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

// --- §3 -----------------------------------------------------------------------
const copies = [
  join(__dirname, "..", "src", "utils", "tr-case.ts"),
  join(__dirname, "..", "..", "Electron", "src", "lib", "tr-case.ts"),
  join(__dirname, "..", "..", "mobil", "src", "utils", "trCase.ts"),
];
const md5s = copies.map((f) => createHash("md5").update(readFileSync(f)).digest("hex"));
check("§3 üç kopyanın md5'i eşit (backend · Electron · mobil)", new Set(md5s).size === 1, md5s.map((h) => h.slice(0, 8)).join(" "));
check(
  "§3 kopyalarda \"tr-TR\" KOD satırında yalnız TR_LOCALE sabitinde (yorum sayılmaz)",
  copies.every((f) => (readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, "").match(/"tr-TR"/g) ?? []).length === 1),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
