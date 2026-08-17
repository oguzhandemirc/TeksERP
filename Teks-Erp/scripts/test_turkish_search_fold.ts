// =============================================================================
// BEKÇİ — Türkçe harf ayrımsız arama (2026-08-17)
// =============================================================================
// Saha talebi: "cisem", "CISEM", "ÇİSEM", "çisem" AYNI sonucu vermeli.
//
// İki ayrı sorun var ve ikisi de ayrı ayrı çözülüyor:
//   1. BÜYÜK/küçük — C-locale ILIKE yalnız ASCII a-z↔A-Z katlar; `i↔İ`, `ç↔Ç`
//      katlamaz (eski davranış, korunuyor).
//   2. HARF DENKLİĞİ — `c` ile `ç` AYRI harflerdir; hiçbir case kuralı bunları
//      eşitlemez. Terim varyantlarına açılarak çözülür (2026-08-17).
//
// Bu test SQL koşmaz; üretilen `where` yapraklarının, dört yazımın da birbirini
// bulmasını sağlayacak biçimde kesiştiğini doğrular. Gerçek eşleşme semantiği
// ILIKE'ın ASCII katlamasına dayanır ve o kısım aşağıda AÇIKÇA modellenir —
// yoksa test "yaprak üretildi" der ama eşleşme garantisi vermez.
// =============================================================================

import { buildTurkishSearch } from "../src/utils/query-parser";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}

interface Leaf {
  contains: string;
  mode?: string;
}

function leaves(term: string): Leaf[] {
  const clauses = buildTurkishSearch<{ name: Leaf }>(term, ["name"]);
  return clauses.map((c) => c.name);
}

/**
 * PostgreSQL C-locale ILIKE modeli: `mode:"insensitive"` YALNIZ ASCII a-z↔A-Z
 * katlar. Türkçe harfler (ç/Ç, ş/Ş, ı/İ …) bire bir eşleşmek zorundadır.
 */
function asciiFold(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
  }
  return out;
}

function matches(leaf: Leaf, stored: string): boolean {
  return leaf.mode === "insensitive"
    ? asciiFold(stored).includes(asciiFold(leaf.contains))
    : stored.includes(leaf.contains);
}

/** Bu terimle arama yapan biri, bu kaydı bulur mu? */
function finds(term: string, stored: string): boolean {
  return leaves(term).some((l) => matches(l, stored));
}

// ── 1. Dört yazım birbirini bulur (talebin birebir karşılığı) ────────────────
const SPELLINGS = ["cisem", "CISEM", "ÇİSEM", "çisem", "Çisem", "CİSEM"];
let crossOk = true;
const misses: string[] = [];
for (const term of SPELLINGS) {
  for (const stored of SPELLINGS) {
    if (!finds(term, stored)) {
      crossOk = false;
      misses.push(`"${term}" → "${stored}"`);
    }
  }
}
check(
  `ÇİSEM'in ${SPELLINGS.length} yazımı birbirini buluyor (${SPELLINGS.length ** 2} kombinasyon)`,
  crossOk,
  misses.join(", ")
);

// ── 2. Diğer harf çiftleri ───────────────────────────────────────────────────
const PAIRS: [string, string][] = [
  ["gulsen", "GÜLŞEN"],
  ["GULSEN", "Gülşen"],
  ["patos", "PATOŞ"],
  ["sogut", "SÖĞÜT"],
  ["ısıtma", "ISITMA"],
  ["isitma", "ısıtma"],
  ["ucgen", "ÜÇGEN"],
];
for (const [term, stored] of PAIRS) {
  check(`"${term}" → "${stored}" bulunuyor`, finds(term, stored));
}

// ── 3. Kelime İÇİNDE arama (contains) bozulmadı ──────────────────────────────
check('"cisem" → "MUSTAFA ÇİSEM TEKSTİL" bulunuyor', finds("cisem", "MUSTAFA ÇİSEM TEKSTİL"));

// ── 4. YANLIŞ eşleşme üretmiyor (varyantlar alakasız kaydı çekmemeli) ────────
check('"patos" → "PANOS" BULMUYOR', !finds("patos", "PANOS"));
check('"cisem" → "GISEM" BULMUYOR', !finds("cisem", "GISEM"));
// Harf DÜŞÜREN varyant üretilirse ("CISEM" → "iSEM") alakasız kayıtlar gelirdi.
// Bu, düzeltilmiş gerçek bir hatanın regresyon sondasıdır.
for (const term of SPELLINGS) {
  const bad = leaves(term).filter((l) => [...l.contains].length !== [...term].length);
  check(
    `"${term}" varyantlarının hepsi ${[...term].length} harf (harf düşmüyor)`,
    bad.length === 0,
    bad.map((b) => b.contains).join(", ")
  );
}

// ── 5. Sorgu patlaması sınırı ────────────────────────────────────────────────
const longTerm = "gumusoglu ısıtma sogutma";
const longLeaves = leaves(longTerm);
check(
  `Uzun terimde yaprak sayısı sınırlı (${longLeaves.length} ≤ 40)`,
  longLeaves.length <= 40,
  `Terim: "${longTerm}"`
);
// Türkçe harf İÇERMEYEN terim tek yaprak kalmalı — bedelsiz yol korunuyor.
check("Katlanacak harf yoksa tek yaprak", leaves("XYZ-4471").length === 1);

// ── 6. Sözleşme: boş terim / boş alan listesi ────────────────────────────────
check("Boş terim → boş dizi", buildTurkishSearch("   ", ["name"]).length === 0);
check("Alan yoksa → boş dizi", buildTurkishSearch("cisem", []).length === 0);

// ── 7. Çok alanlı kullanımda her alan için tüm yapraklar üretilir ────────────
const multi = buildTurkishSearch<Record<string, Leaf>>("cisem", ["name", "code"]);
const single = buildTurkishSearch("cisem", ["name"]);
check(
  `Çok alanlı: ${multi.length} = 2 × ${single.length}`,
  multi.length === single.length * 2
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
