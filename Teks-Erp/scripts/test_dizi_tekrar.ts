// =============================================================================
// test_dizi_tekrar — atkı/çözgü dizi kodunda tekrar kısaltması "10x(A2 B2 C1) D4" (Seyitoğlu, 2026-11-25). SAF, DB'siz.
// Kabul: 4 iplikli kartta adetler A20 B20 C10 D4, açılım 54 atkı; "(…)x10" ve "10*(…)" aynı normal biçime iner;
// kısaltmasız eski kodlar aynen; parantez hataları / 0 tekrar / >512 açılım / kartta olmayan harf 400 (Türkçe).
// Çözgü dizilimi "5x(2A 1B) 4C" açılır, hatalı parantez null. PARİTE TABLOSU panel `sequence-edit.test.ts` ile aynı.
// =============================================================================
import { expandWarpSequence } from "../src/services/helpers/warp-sequence.helper";
import { expandWeftSequence, parseWeftSequence } from "../src/services/helpers/weft-sequence.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

function errOf(fn: () => unknown): { code?: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    const err = e as { message: string; details?: { code?: string } };
    return { code: err.details?.code, message: err.message };
  }
}

// PARİTE TABLOSU — panel `parseSequenceCode` + `runsToBoxes` aynı açılımı vermelidir (1-tabanlı harf no).
const PARITY: Array<{ code: string; expanded: number[] | null }> = [
  { code: "A4 B1 A4 C1", expanded: [1, 1, 1, 1, 2, 1, 1, 1, 1, 3] },
  { code: "3x(A1 B1) C2", expanded: [1, 2, 1, 2, 1, 2, 3, 3] },
  { code: "(A1 B1)x3 C2", expanded: [1, 2, 1, 2, 1, 2, 3, 3] },
  { code: "2*(A2 C1) B1", expanded: [1, 1, 3, 1, 1, 3, 2] },
  { code: "B1 2X(A1 C1)", expanded: [2, 1, 3, 1, 3] },
  { code: "3x((A1) B1)", expanded: null },
  { code: "3x(A1 B1 C1", expanded: null },
  { code: "0x(A1 B1 C1)", expanded: null },
  { code: "(A1 B1 C1)", expanded: null },
];

function main(): void {
  console.log("§1 atkı: tekrar kısaltması (kabul örneği)");
  const p = parseWeftSequence("10x(A2 B2 C1) D4", 4);
  check("§1a adetler A20 B20 C10 D4", JSON.stringify(p.picksBySortOrder) === "[20,20,10,4]", JSON.stringify(p.picksBySortOrder));
  check("§1b normal biçim kısaltmayı korur", p.normalized === "10x(A2 B2 C1) D4", p.normalized);
  const e = expandWeftSequence("10x(A2 B2 C1) D4", 4, 512)!;
  check("§1c açılım 54 atkı", e?.length === 54, String(e?.length));
  check("§1d ilk 5 = 1,1,2,2,3 · son 4 = 4", JSON.stringify(e.slice(0, 5)) === "[1,1,2,2,3]" && JSON.stringify(e.slice(-4)) === "[4,4,4,4]");
  const q = parseWeftSequence(" (a2 b2 c1) X 10  d4 ", 4);
  check("§1e (…)x10 aynı adet + aynı normal biçim", JSON.stringify(q.picksBySortOrder) === "[20,20,10,4]" && q.normalized === "10x(A2 B2 C1) D4", q.normalized);
  const r = parseWeftSequence("10*(A2,B2,C1) D4", 4);
  check("§1f 10*(…) virgüllü aynı normal biçim", r.normalized === "10x(A2 B2 C1) D4", r.normalized);
  check("§1g açılım = (…)x10 açılımı", JSON.stringify(expandWeftSequence("(A2 B2 C1)x10 D4", 4, 512)) === JSON.stringify(e));
  check("§1h iki grup", JSON.stringify(parseWeftSequence("2x(A1 B1) 3x(C1) A1", 3).picksBySortOrder) === "[3,2,3]");

  console.log("§2 atkı: kısaltmasız eski kodlar aynen");
  const old = parseWeftSequence(" a4 b1  A4 c1 ", 3);
  check("§2a A4 B1 A4 C1 → [8,1,1] + aynı metin", JSON.stringify(old.picksBySortOrder) === "[8,1,1]" && old.normalized === "A4 B1 A4 C1");
  check("§2b eski açılım A2 C1 B1 → [1,1,3,2]", JSON.stringify(expandWeftSequence("A2 C1 B1", 3, 512)) === "[1,1,3,2]");
  check("§2c kısaltmasız uzun kod tavanla reddedilmez (bugünkü davranış)", parseWeftSequence("A600 B1", 2).picksBySortOrder[0] === 600);

  console.log("§3 atkı: hatalar 400 + Türkçe");
  const bad = (code: string, yarns = 3) => errOf(() => parseWeftSequence(code, yarns));
  const unclosed = bad("10x(A2 B2 C1");
  check("§3a kapanmayan parantez", unclosed?.code === "WEFT_SEQUENCE_INVALID" && /kapanmamış/.test(unclosed.message), unclosed?.message);
  const nested = bad("2x(A1 3x(B1) C1)");
  check("§3b iç içe parantez", nested?.code === "WEFT_SEQUENCE_INVALID" && /iç içe/.test(nested.message), nested?.message);
  const zero = bad("0x(A1 B1 C1)");
  check("§3c 0 tekrar", zero?.code === "WEFT_SEQUENCE_INVALID" && /sıfırdan büyük/.test(zero.message), zero?.message);
  const big = bad("103x(A2 B2 C1)");
  check("§3d açılım > 512 (515)", big?.code === "WEFT_SEQUENCE_INVALID" && /515 atkı/.test(big.message) && /512/.test(big.message), big?.message);
  check("§3d' sınırda 512 geçer", parseWeftSequence("128x(A2 B1 C1)", 3).picksBySortOrder[0] === 256);
  check("§3e kartta olmayan harf", bad("10x(A2 D1) B1 C1")?.code === "WEFT_SEQUENCE_LETTER_UNKNOWN");
  const noCount = bad("(A1 B1) C1");
  check("§3f tekrar sayısız parantez", noCount?.code === "WEFT_SEQUENCE_INVALID" && /tekrar sayısı/.test(noCount.message), noCount?.message);
  check("§3g boş parantez", bad("3x() A1 B1 C1")?.code === "WEFT_SEQUENCE_INVALID");
  check("§3h bozuk kısaltma ekranı düşürmez (null)", expandWeftSequence("3x(A1 B1", 2, 512) === null);

  console.log("§4 çözgü dizilimi");
  const w = expandWarpSequence("5x(2A 1B) 4C", [10, 5, 4]);
  check("§4a 5x(2A 1B) 4C → 19 tel rapor", w?.repeat.length === 19 && JSON.stringify(w.repeat.slice(0, 3)) === "[1,1,2]" && JSON.stringify(w.repeat.slice(-4)) === "[3,3,3,3]");
  check("§4b kartla tel uyumu (10/5/4)", w?.matchesYarnEnds === true && w.repeatCount === 1);
  check("§4c (A2 B1)x5 C4 aynı açılım", JSON.stringify(expandWarpSequence("(A2 B1)x5 C4", [10, 5, 4])?.repeat) === JSON.stringify(w?.repeat));
  check("§4d eski not aynen (2A 1B)", JSON.stringify(expandWarpSequence("2A 1B", [2334, 1166])?.repeat) === "[1,1,2]");
  check("§4e iç içe / kapanmayan / sayısız → null", expandWarpSequence("2x(1A 2x(1B))", [5, 5]) === null && expandWarpSequence("2x(1A 1B", [5, 5]) === null && expandWarpSequence("(1A 1B)", [5, 5]) === null);
  check("§4f tekrar tavanı aşılır → null", expandWarpSequence("1000x(2A 1B)", [5000, 5000]) === null);

  console.log("§5 parite tablosu (panel aynası)");
  for (const c of PARITY) {
    const got = expandWeftSequence(c.code, 3, 512);
    check(`§5 ${c.code}`, JSON.stringify(got) === JSON.stringify(c.expanded), JSON.stringify(got));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
