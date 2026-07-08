// D-13: foldType tek kaynak sözlüğü — normalize + Zod şeması + servis guard'ı.
// Server'sız birim testi: helper doğrudan import, HTTP yok.
//   npx tsx scripts/test_fold_type.ts

import {
  FOLD_TYPES,
  normalizeFoldType,
  foldTypeSchema,
  canonicalizeFoldTypeInPlace,
} from "../src/services/helpers/fold-type";

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
  console.log("=== 1) FOLD_TYPES sözlüğü ===");
  check("kanonik değerler [2-KAT, 4-KAT]", JSON.stringify([...FOLD_TYPES]) === JSON.stringify(["2-KAT", "4-KAT"]));

  console.log("\n=== 2) normalizeFoldType kanonikleştirme ===");
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
  check('normalize("3-KAT") → "3-KAT" (kanal-dışı, korunur)', normalizeFoldType("3-KAT") === "3-KAT");

  console.log("\n=== 3) foldTypeSchema (Zod) — kanonikleştir, reddetme yok ===");
  check('parse("4-kat") → "4-KAT"', foldTypeSchema.parse("4-kat") === "4-KAT");
  check('parse("2 KAT") → "2-KAT"', foldTypeSchema.parse("2 KAT") === "2-KAT");
  check('parse("TUP") → "TUP" (özel değer geçer)', foldTypeSchema.parse("TUP") === "TUP");
  check('parse("") → null (temizle)', foldTypeSchema.parse("") === null);
  check("parse(null) → null", foldTypeSchema.parse(null) === null);
  check("parse(undefined) → undefined (update no-op)", foldTypeSchema.parse(undefined) === undefined);

  console.log("\n=== 4) canonicalizeFoldTypeInPlace (servis guard) ===");
  const d1: Record<string, unknown> = { foldType: "4-kat", other: 1 };
  canonicalizeFoldTypeInPlace(d1);
  check('{foldType:"4-kat"} → "4-KAT" (yerinde)', d1.foldType === "4-KAT" && d1.other === 1);

  const d2: Record<string, unknown> = { name: "x" };
  canonicalizeFoldTypeInPlace(d2);
  check("foldType yoksa → dokunmaz (no-op)", !("foldType" in d2));

  const d3: Record<string, unknown> = { foldType: null };
  canonicalizeFoldTypeInPlace(d3);
  check("{foldType:null} → null korunur (temizle)", d3.foldType === null);

  const d4: Record<string, unknown> = { foldType: "TÜP" };
  canonicalizeFoldTypeInPlace(d4);
  check('{foldType:"TÜP"} → "TÜP" korunur (özel değer reddedilmez)', d4.foldType === "TÜP");

  console.log("\n──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
