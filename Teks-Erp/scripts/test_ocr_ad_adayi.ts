// =============================================================================
// TEST (gelen belge, 2026-11-08 saha): okunan sahip adına OCR'a dayanıklı aday üretimi (saf, DB'siz)
// =============================================================================
//   §1 aday OLMALI: "HHL M"→HHL (kelime kapsama) · "HLL"→HHL (karakter) · "ÖZTEKS1L"→ÖZTEKSİL (OCR eşleme) ·
//      "H.H.L."→HHL ve "OZ-TEKS"→"ÖZ TEKS" (ayraç/nokta) · önek "MAVIDER"→"MAVIDERE BOYAHANE"
//   §2 aday OLMAMALI: alakasız kısa ad · tek harf okuma · tek harfli cari ("M" ⊂ "HHL M" değil) · 2 harfli okuma
//   §3 sıralama ve tavan: tam eşleşme en üstte (1), en çok 5 aday, puan azalan
// Negatif sonda (2026-11-08): `OCR_PAIRS` boşaltılınca §1 ÖZTEKS1L 0,906 → 1 ❌ · `OCR_CANDIDATE_MIN_CHARS` 3→1 → §2 3 ❌ ·
// (a)+(b)+(c) dalları kapatılınca (yalnız firma benzerliği) §1 "HHL M" + ÖZTEKS1L + §3 tavan 3 ❌; geri alındı, 16/16.
// Çalıştır: npx tsx scripts/test_ocr_ad_adayi.ts
// =============================================================================
import { OCR_CANDIDATE_MAX, ocrCandidateScore, ocrNameCandidates } from "../src/services/helpers/ocr-name-candidate.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, info?: unknown): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${ok || info === undefined ? "" : ` → ${JSON.stringify(info)}`}`);
}

const row = (id: string, name: string) => ({ id, code: `K-${id}`, name });
const ids = (text: string, rows: ReturnType<typeof row>[]) => ocrNameCandidates(text, rows).map((c) => c.id);

// §1
const hhl = row("hhl", "HHL");
const catalog = [hhl, row("ozt", "ÖZTEKSİL"), row("mav", "MAVIDERE BOYAHANE LTD ŞTİ"), row("ozteks", "ÖZ TEKS"), row("ali", "ALİ"), row("m", "M"), row("xyz", "XYZ")];
check("§1 ⭐ 'HHL M' → HHL aday", ids("HHL M", catalog).includes("hhl"), ocrNameCandidates("HHL M", catalog));
check("§1 ⭐ 'HLL' → HHL aday", ids("HLL", catalog).includes("hhl"), ocrNameCandidates("HLL", catalog));
check("§1 ⭐ 'ÖZTEKS1L' → ÖZTEKSİL aday (≥ 0,95: OCR eşlemesi tam)", ocrCandidateScore("ÖZTEKS1L", "ÖZTEKSİL") >= 0.95 && ids("ÖZTEKS1L", catalog)[0] === "ozt", ocrNameCandidates("ÖZTEKS1L", catalog));
check("§1 'H.H.L.' → HHL tam (1)", ocrCandidateScore("H.H.L.", "HHL") === 1);
check("§1 'OZ-TEKS' → 'ÖZ TEKS' tam (1)", ocrCandidateScore("OZ-TEKS", "ÖZ TEKS") === 1);
check("§1 önek 'MAVIDER' → MAVIDERE BOYAHANE aday", ids("MAVIDER", catalog).includes("mav"), ocrNameCandidates("MAVIDER", catalog));
check("§1 'HHL TEKSTİL A.Ş.' → HHL tam (gürültü eki)", ocrCandidateScore("HHL TEKSTİL A.Ş.", "HHL") === 1);

// §2
check("§2 ⭐ alakasız kısa ad: 'HHL M' ↛ XYZ, ALİ", !ids("HHL M", catalog).includes("xyz") && !ids("HHL M", catalog).includes("ali"), ocrNameCandidates("HHL M", catalog));
check("§2 ⭐ tek harfli cari 'M' 'HHL M'ye aday değil", !ids("HHL M", catalog).includes("m"));
check("§2 ⭐ tek harf okuma → aday yok", ocrNameCandidates("H", catalog).length === 0);
check("§2 2 harf okuma → aday yok", ocrNameCandidates("HH", catalog).length === 0);
check("§2 alakasız 3 harf: 'KRT' ↛ HHL", ocrCandidateScore("KRT", "HHL") === 0);
check("§2 3 harfli parça ortada içerilmez: 'ALİ' ↛ 'KALİTE'", ocrCandidateScore("ALİ", "KALİTE") === 0);

// §3
const many = [row("e", "HHL"), ...[1, 2, 3, 4, 5, 6].map((i) => row(`h${i}`, `HHL ${"ABCDEF"[i - 1]}X`))];
const top = ocrNameCandidates("HHL", many);
check(`§3 ⭐ en çok ${OCR_CANDIDATE_MAX} aday`, top.length === OCR_CANDIDATE_MAX, top);
check("§3 ⭐ tam eşleşme en üstte (1)", top[0]?.id === "e" && top[0].score === 1, top[0]);
check("§3 puan azalan", top.every((c, i) => i === 0 || top[i - 1].score >= c.score));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
