// =============================================================================
// ESLint MESAJI → KURAL ANAHTARI — lint kapısı ve lint tavanı aynı soruyu sorar
// =============================================================================
// `ruleId: null` TEK sınıf değildir (ölçüldü 2026-09-13, ESLint 9 JSON):
//   · parse çökmesi   → { ruleId: null, fatal: true }   — ARIZA, ihlal değil (çıkış 2)
//   · kullanılmayan eslint-disable (reportUnusedDisableDirectives: "error")
//                     → { ruleId: null, severity: 2 }   — İHLAL, dosya:satır ile (çıkış 1)
// Tavan ikisini aynı kefeye koyup "parse hatası / ARIZA" basıyordu: bir gereksiz
// `eslint-disable` yorumu kapıyı herkese kapattı, verdikt (benim/yabancı) hiç sorulmadı.
// Ayrım tek yerde yaşar; iki tüketici (lint-gate · check-lint-baseline) buradan okur.
// =============================================================================

/** Kural adı olmayan ihlalin sentetik anahtarı — tavan/cırcır bu adla sayar. */
export const UNUSED_DIRECTIVE_KURALI = "unused-disable-directive";

/**
 * Mesajın kural anahtarı: gerçek `ruleId` · sentetik anahtar · `null` (= ARIZA).
 * Yalnız `fatal: true` arızadır; başka hiçbir alan (severity, mesaj metni) ölçüt değil.
 */
export function kuralAnahtari(m) {
  if (m.ruleId) return m.ruleId;
  return m.fatal ? null : UNUSED_DIRECTIVE_KURALI;
}
