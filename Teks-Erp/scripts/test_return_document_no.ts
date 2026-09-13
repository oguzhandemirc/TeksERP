// =============================================================================
// test_return_document_no — iade belge numarası FABRİKA gününden (DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/test_return_document_no.ts
//   CI gibi: TZ=UTC npx tsx scripts/test_return_document_no.ts
//
// `IADE-GGAAYY-<id6>` numarasının GGAAYY parçası `createdAt`in FABRİKA takvim
// gününden gelir (`ddmmyy` → `factoryYmd`). Eski kod `getDate()/getMonth()/
// getFullYear()` ile SÜREÇ saat dilimini kullanıyordu: UTC host'ta 00:00–03:00
// (İstanbul) arası oluşturulan iade bir ÖNCEKİ günün numarasını taşırdı —
// belge numarası kimliktir, kayması kimlik kusurudur.
//
// NEGATİF SONDA (saatten bağımsız, sabit anlar): 21:30Z fabrika için ertesi
// gündür. Mutasyon — `returnDocumentNo`u eski `getDate()` formülüne çevir ve
// `TZ=UTC` ile koş → §1 kırmızı; `TZ=Europe/Istanbul` ile aynı mutasyon yeşil
// kalır (değişken TZ'dir), düzeltme iki TZ'de de yeşil.

import { returnDocumentNo } from "../src/services/return.service";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ID = "a1b2c3d4-0000-4000-8000-000000000000";
const TZ = process.env.TZ ?? "(süreç)";

// §1 — pencerenin içi/dışı ve mevsimden bağımsızlık (Türkiye sabit UTC+3, DST yok;
// kış anı mevsim farkı ÖLÇMEZ, olmadığını KİLİTLER).
const cases: Array<[string, string]> = [
  ["2026-09-13T21:30:00Z", "IADE-140926-A1B2C3"], // İstanbul 00:30 → 14.09
  ["2026-09-13T20:59:59Z", "IADE-130926-A1B2C3"], // İstanbul 23:59:59 → 13.09
  ["2026-01-15T21:30:00Z", "IADE-160126-A1B2C3"], // kış, aynı kural → 16.01
  ["2026-12-31T21:00:00Z", "IADE-010127-A1B2C3"], // yıl devri → 01.01.27
];
for (const [iso, expected] of cases) {
  const got = returnDocumentNo(new Date(iso), ID);
  check(`belge no fabrika gününden @${iso}`, got === expected, `got=${got} beklenen=${expected} TZ=${TZ}`);
}

// §2 — sözleşmeyle tutarlılık: GGAAYY parçası factoryYmd'nin aynasıdır.
for (const [iso] of cases) {
  const at = new Date(iso);
  const ymd = factoryYmd(at);
  const ggaayy = `${ymd.slice(8, 10)}${ymd.slice(5, 7)}${ymd.slice(2, 4)}`;
  check(`GGAAYY = factoryYmd aynası @${iso}`, returnDocumentNo(at, ID).slice(5, 11) === ggaayy);
}

// §3 — kimlik parçası: id'nin ilk 6 karakteri, BÜYÜK harf.
check("id parçası ilk 6 karakter, büyük harf", returnDocumentNo(new Date("2026-09-14T09:00:00Z"), "zz9y8x-rest").endsWith("-ZZ9Y8X"));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
