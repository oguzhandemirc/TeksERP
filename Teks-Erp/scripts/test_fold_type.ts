// D-13: foldType BİÇİM normalleştirmesi + Zod şeması.
// Server'sız birim testi: helper doğrudan import, HTTP yok.
//   npx tsx scripts/test_fold_type.ts
//
// ⚠️ KAPSAM: bu dosya yalnız SENKRON BİÇİM işini ölçer. Katalog geçerliliği
// (`resolveFoldTypeForWrite` / `applyFoldTypeForWriteInPlace`) DB ister ve
// `test_fold_catalog.ts`te ölçülür — ikisini karıştırma.

import { normalizeFoldType, foldTypeSchema } from "../src/services/helpers/fold-type";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

function main(): void {
  console.log("=== 1) normalizeFoldType kanonikleştirme ===");
  const cases: Array<[string, string | null]> = [
    ["4-KAT", "4-KAT"],
    ["4-kat", "4-KAT"],
    ["4 Kat", "4-KAT"],
    ["4KAT", "4-KAT"],
    ["4_kat", "4-KAT"],
    ["  2-kat  ", "2-KAT"],
    ["2 KAT", "2-KAT"],
    ["", null],
    ["   ", null],
  ];
  for (const [inp, exp] of cases) {
    check(`normalize("${inp}") → ${exp}`, normalizeFoldType(inp) === exp, `got=${normalizeFoldType(inp)}`);
  }
  // Tanınmayan (TÜP/özel) → trim'lenip DEĞİŞMEDEN geçer (reddetme yok)
  check('normalize("TUP") → "TUP" (özel değer korunur)', normalizeFoldType("TUP") === "TUP");
  check('normalize("  Tüp ") → "Tüp" (yalnız trim)', normalizeFoldType("  Tüp ") === "Tüp");

  console.log("\n=== 2) RAKAM SINIFI GENEL — katalog 2/4 ile sınırlı değil ===");
  // ⚠️ Regex eskiden `[24]` idi. Fabrika katalogdan "6-KAT" eklediğinde
  // "6 kat" yazımı normalleşmez, katalog eşleşmesi kaçar ve değer ham geçerdi.
  // Bu üç kontrol tam olarak o gerilemeyi yakalar.
  check('normalize("6 kat") → "6-KAT"', normalizeFoldType("6 kat") === "6-KAT", `got=${normalizeFoldType("6 kat")}`);
  check('normalize("8KAT") → "8-KAT"', normalizeFoldType("8KAT") === "8-KAT", `got=${normalizeFoldType("8KAT")}`);
  check('normalize("3-KAT") → "3-KAT"', normalizeFoldType("3-KAT") === "3-KAT");
  check('normalize("12_kat") → "12-KAT" (çok haneli)', normalizeFoldType("12_kat") === "12-KAT");

  console.log("\n=== 3) foldTypeSchema (Zod) — yalnız BİÇİM, reddetme yok ===");
  check('parse("4-kat") → "4-KAT"', foldTypeSchema.parse("4-kat") === "4-KAT");
  check('parse("2 KAT") → "2-KAT"', foldTypeSchema.parse("2 KAT") === "2-KAT");
  check('parse("6 kat") → "6-KAT"', foldTypeSchema.parse("6 kat") === "6-KAT");
  check('parse("TUP") → "TUP" (özel değer geçer)', foldTypeSchema.parse("TUP") === "TUP");
  check('parse("") → null (temizle)', foldTypeSchema.parse("") === null);
  check("parse(null) → null", foldTypeSchema.parse(null) === null);
  check("parse(undefined) → undefined (update no-op)", foldTypeSchema.parse(undefined) === undefined);

  console.log("\n──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
