// =============================================================================
// test_warp_sequence — çözgü dizilim notu açıcısı (`warp-sequence.helper`, kart görseli 2026-11-22). SAF, DB'siz.
// Kabul: "2A 1B" × 3500 tel → rapor [1,1,2], 1166 tekrar + 2 artık; "A2 B1" / "1 A 1 B" / "ABAB" okunur;
// okunamayan not, kartta olmayan harf, tavan aşımı null (ekran oransal bloğa düşer, hata atmaz).
// =============================================================================
import { expandWarpSequence, WARP_SEQUENCE_MAX_REPEAT } from "../src/services/helpers/warp-sequence.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

function main(): void {
  console.log("§1 biçimler");
  const a = expandWarpSequence("2A 1B", [2334, 1166]);
  check("§1a 2A 1B × 3500 → [1,1,2], 1166 rapor + 2 artık", JSON.stringify(a?.repeat) === "[1,1,2]" && a?.repeatCount === 1166 && a.remainder === 2 && a.totalEnds === 3500, JSON.stringify(a && { ...a, repeat: a.repeat.length }));
  check("§1b tel dağılımı kart satırıyla aynı → matchesYarnEnds", a?.matchesYarnEnds === true);
  check("§1c A2 B1 aynı açılım", JSON.stringify(expandWarpSequence("A2 B1", [2334, 1166])?.repeat) === "[1,1,2]");
  check("§1d boşluklu '1 A 1 B' + küçük harf", JSON.stringify(expandWarpSequence(" 1 a 1 b ", [10, 10])?.repeat) === "[1,2]");
  check("§1e yalnız harf 'ABAC' = birer tel", JSON.stringify(expandWarpSequence("ABAC", [2, 1, 1])?.repeat) === "[1,2,1,3]");
  check("§1f virgül/artı ayraç", JSON.stringify(expandWarpSequence("2A, 1B + 1C", [2, 1, 1])?.repeat) === "[1,1,2,3]");
  const m = expandWarpSequence("2A 1B", [1750, 1750]);
  check("§1g kart telleriyle uyuşmayan dizilim → matchesYarnEnds false (açılım yine döner)", m !== null && m.matchesYarnEnds === false);

  console.log("§2 null kolları");
  check("§2a boş / null not", expandWarpSequence("", [10]) === null && expandWarpSequence(null, [10]) === null && expandWarpSequence(undefined, [10]) === null);
  check("§2b serbest metin ('1 siyah 1 beyaz')", expandWarpSequence("1 siyah 1 beyaz", [10, 10]) === null);
  check("§2c kartta olmayan harf (C, 2 satır)", expandWarpSequence("1A 1C", [10, 10]) === null);
  check("§2d karışık biçim (2A B1) okunmaz", expandWarpSequence("2A B1", [10, 10]) === null);
  check("§2e sıfır adet", expandWarpSequence("0A 1B", [10, 10]) === null);
  check("§2f rapor tavanı aşılır", expandWarpSequence(`${WARP_SEQUENCE_MAX_REPEAT}A 1B`, [5000, 5000]) === null && expandWarpSequence(`${WARP_SEQUENCE_MAX_REPEAT}A`, [5000]) !== null);
  check("§2g satırsız kart (iplik yok)", expandWarpSequence("1A", []) === null);
}

main();
console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
