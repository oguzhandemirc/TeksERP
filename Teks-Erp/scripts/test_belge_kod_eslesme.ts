// =============================================================================
// BELGE KOD EŞLEŞMESİ — saf birim bekçisi (Gülkesim K30-E; DB yok)
// =============================================================================
// `src/services/helpers/doc-code-match.helper.ts`: istasyonda "Belge okut"un belge no ve parti no yolları okunan
// değeri kayıtlı değerle bu tek helper'dan karşılaştırır. Sınanan:
//   §1 tam eşleşme: kırpma + harf duyarsız (İ/ı katlaması), dil-yerel büyük harf yok
//   §2 ayraç toleransı: boşluk / tire / nokta / alt çizgi / yıldız yok sayılır
//   §3 OCR karışıklığı YALNIZ rakam koşusunda: O→0, I/l→1, S→5, B→8; rakamsız koşu dokunulmaz
//   §4 ⭐ kısa değer (<4) toleranslı eşleşmez, yalnız tam eşleşir
//   §5 ⭐ matchCodes: tam eşleşme toleranslıyı ezer; kayıttaki yazım döner; tekil; boş eşleşmez
// Negatif sonda (2026-11-04 ölçüldü, 16/2): MIN_TOLERANT_CODE_LENGTH 0'a çekilince §4 iki ❌; tam eşleşme varken
// toleranslılar da dönerse (exact+tolerant birleşir) §5 "tam ezer" iki ❌.
// =============================================================================
import { codeMatchTier, exactCodeKey, matchCodes, tolerantCodeKey } from "../src/services/helpers/doc-code-match.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

console.log("=== Belge kod eşleşmesi (K30-E) birim bekçisi ===\n");

console.log("§1 tam eşleşme");
check("§1 harf duyarsız + kırpma", codeMatchTier("  p2618733 ", "P2618733") === "EXACT");
check("§1 İ/ı katlaması (dil-yerel büyük harf yok)", exactCodeKey("pİı") === "PII" && codeMatchTier("pii4", "PİI4") === "EXACT", exactCodeKey("pİı"));
check("§1 boş değer eşleşmez", codeMatchTier("", "") === null && codeMatchTier(null, "P2618733") === null && codeMatchTier("P2618733", undefined) === null);

console.log("§2 ayraç toleransı");
check("§2 boşluk/tire/nokta/alt çizgi/yıldız", tolerantCodeKey(" P-26.18_73 3* ") === "P2618733", tolerantCodeKey(" P-26.18_73 3* "));
check("§2 eğik çizgi ayraçtır ('P26/18733', 'P26\\18733')", codeMatchTier("P26/18733", "P2618733") === "TOLERANT" && tolerantCodeKey("P26\\18733") === "P2618733", tolerantCodeKey("P26/18733"));
check("§2 ayraç farkı toleranslı eşleşir", codeMatchTier("P26-18733", "P2618733") === "TOLERANT");

console.log("§3 OCR karışıklığı rakam koşusunda");
check("§3 'P26I8733' → P2618733", codeMatchTier("P26I8733", "P2618733") === "TOLERANT", tolerantCodeKey("P26I8733"));
check("§3 küçük l → 1", tolerantCodeKey("P26l8733") === "P2618733", tolerantCodeKey("P26l8733"));
check("§3 O→0, S→5, B→8", tolerantCodeKey("9O5S8B") === "905588" && codeMatchTier("1O2S3B", "102538") === "TOLERANT", tolerantCodeKey("9O5S8B"));
check("§3 rakamsız koşu dokunulmaz ('SOL-B' harf kalır)", tolerantCodeKey("SOL-B") === "SOLB" && codeMatchTier("SOLB", "5018") === null, tolerantCodeKey("SOL-B"));
check("§3 farklı rakam eşleşmez (9 ≠ 8)", codeMatchTier("96673156", "86673156") === null);

console.log("§4 kısa değer");
check("§4 ⭐ 3 karakter: 'B1O' ≠ '810' (tolerans yok)", codeMatchTier("B1O", "810") === null);
check("§4 ⭐ 3 karakter tam eşleşme yine EXACT", codeMatchTier("p01", "P01") === "EXACT");
check("§4 ⭐ ayraçla uzayan kısa değer toleranslı değil ('P-0-1' ≠ 'P01')", codeMatchTier("P-0-1", "P01") === null);
check("§4 4 karakter toleranslı eşleşir ('B1O2' = '8102')", codeMatchTier("B1O2", "8102") === "TOLERANT");

console.log("§5 matchCodes");
const m1 = matchCodes(["P26I8733"], ["P2618733", "P2618734", null, "P2618733"]);
check("§5 toleranslı: kayıttaki yazım, tekil", m1?.tier === "TOLERANT" && JSON.stringify(m1.values) === JSON.stringify(["P2618733"]), JSON.stringify(m1));
const m2 = matchCodes(["P26I8733"], ["P2618733", "p26i8733"]);
check("§5 ⭐ tam eşleşme toleranslıyı ezer", m2?.tier === "EXACT" && JSON.stringify(m2.values) === JSON.stringify(["p26i8733"]), JSON.stringify(m2));
const m3 = matchCodes(["ZZ99", "P2618733"], ["P26-18733", "P2618733"]);
check("§5 ⭐ çok okunan değerde bir tam eşleşme bütün toleranslıları ezer", m3?.tier === "EXACT" && JSON.stringify(m3.values) === JSON.stringify(["P2618733"]), JSON.stringify(m3));
check("§5 hiçbiri → null", matchCodes(["P9999999"], ["P2618733"]) === null && matchCodes([], ["P2618733"]) === null && matchCodes([null, ""], [""]) === null);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
