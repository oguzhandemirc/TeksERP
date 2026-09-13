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
//    OKUYAN (16 adaptörün kod haritası) aynı helper'ı (`importKey` =
//    foldCodeForCompare) çağırır; biri `upperTr`/`toUpperCase()`/ham `toLocale`
//    ile ayrışırsa bugün olmayan bir kusur doğar ("sip" anahtarı "SİP" ile
//    aranır, DB'deki "SIP" bulunmaz) ve yalnız bu sonda görür.
//    Negatif sonda: bir adaptörde `importKey(r.code)` → `upperTr(r.code)`.
// §4 KOD ANAHTARI i/İ — "Sip" · "SIP" · "sİp" tek anahtara düşer (importKey);
//    `upperTr` düşürmezdi (fabrika kopyasında 2 kod bu sınıfta, çarpışma 0).
// §3 ÜÇ KOPYA BAYT-BAYT — backend · Electron · mobil ayrı projedir, ortak modül
//    import edilemez (search-fold emsali); md5 eşitliği ölçülür. Negatif sonda:
//    bir kopyada bir karakter değiştir → kırmızı.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lowerTr, upperTr } from "../src/utils/tr-case";
import { importKey } from "../src/services/import/import-key";

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
const writer = readFileSync(join(ROOT, "import.service.ts"), "utf8").replace(/\/\/.*$/gm, "");
check("§2 yazan (import.service) anahtarı importKey ile katlıyor", (writer.match(/importKey\(key\)/g) ?? []).length === 3 && /from "\.\/import-key"/.test(writer));
check("§2 yazan'da ham toLocale*Case yok, anahtarda upperTr yok", !/toLocale(Upper|Lower)Case\(/.test(writer) && !/upperTr\(key\)/.test(writer));

const adapterDir = join(ROOT, "adapters");
const adapters = readdirSync(adapterDir).filter((f) => f.endsWith(".adapter.ts"));
let okuyan = 0;
for (const f of adapters) {
  const src = readFileSync(join(adapterDir, f), "utf8").replace(/\/\/.*$/gm, "");
  const foldsCode = /importKey\((\w+\.code|parts\.\w+|raw)/.test(src);
  const rawFold = /toLocale(Upper|Lower)Case\(/.test(src);
  // Harita ANAHTARI üzerinde upperTr/toUpperCase() YASAK — yazanla ayrışır. (fabric-property'nin
  // `c.trim().toUpperCase()`ı özellik DEĞERİ kodunu ayrıştırır, harita anahtarı değil.)
  const otherOnKey =
    /upperTr\((\w+\.code|parts\.\w+|raw)\b/.test(src) ||
    /(\w+\.code|customerCode|targetCode|raw)(\s*\?\?\s*"")?\)?\.toUpperCase\(\)/.test(src);
  if (foldsCode) okuyan++;
  check(`§2 okuyan ${f}: anahtar importKey · ham toLocale yok · upperTr/toUpperCase anahtarda yok`, !rawFold && !otherOnKey);
}
check("§2 kod haritası kuran adaptör sayısı ≥ 14 (yazan↔okuyan çifti var)", okuyan >= 14, `okuyan=${okuyan}`);
for (const f of ["import-lookup.ts", "import-revert.branches.ts"]) {
  const src = readFileSync(join(ROOT, f), "utf8").replace(/\/\/.*$/gm, "");
  check(`§2 ${f} anahtarı importKey ile`, /importKey\(/.test(src) && !/upperTr\((value|keyValue)\)/.test(src));
}

// --- §4 -----------------------------------------------------------------------
const variants = ["Sip", "SIP", "sİp", "sip", " sip "];
const keys = new Set(variants.map(importKey));
check("§4 importKey: i/İ/ı/I ve boşluk varyantları TEK anahtar", keys.size === 1 && keys.has("SIP"), [...keys].join(","));
check("§4 upperTr aynı varyantları ayırır (eski delik belgelendi)", new Set(variants.map((v) => upperTr(v.trim()))).size > 1);
// Fabrika kopyasındaki sınıf (kod değeri YAZILMAZ): 'i' içeren kodun eski/yeni anahtarı farklıdır.
check("§4 'i' içeren sentetik kod: upperTr ≠ importKey, importKey ASCII", upperTr("mitra-01") !== importKey("mitra-01") && importKey("mitra-01") === "MITRA-01");
check("§4 'i' içermeyen kod: iki katlama aynı (geçiş anahtarı değiştirmez)", upperTr("kumas-055") === importKey("kumas-055"));

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
