// =============================================================================
// DOKUMA RAPORLARI — SAF KATMAN: oran biçimi · kaynak etiketleri
// =============================================================================
// Karonun rejimi Raporlar hub'ının kendi biçimindedir: `Reports/tile-config.ts`
// `featureFlag: "dokumaEnabled"` (`ReportsHubPage` `ctx[featureFlag]` ile süzer, palet
// `regimePredicate` ile türetir) — ayrı bir yüklem fonksiyonu ÖLÜ KOD olurdu; bekçi
// `dokuma-regime.test.ts` karo nesnesinin kendisini ve backend `test_dokuma_regime_gate
// §7d` (reports kolu) tile-config metnini ölçer. Referans fabrikada karo belirmez.
// ⚠️ YETKİ DUVARI DEĞİL: kişi kapısı `report:production`; asıl sed BACKEND'de
// (`requireDokumaEnabled`, `reports/dokuma.report.routes`).
// =============================================================================

/**
 * Oran hücresi — `null` ÖLÇÜLEMEDİ demektir, 0 değil (rapor sözleşmesi ①: "boş
 * hücre değil BEYAN"). Tek yerde biçimlenir ki hiçbir sayfa `?? 0` yazmasın.
 */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "ölçülemedi";
  return `%${value.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

/** Kaynak etiketi — `SIMULATED` `OPERATOR`dan AYRI yazılır (farklı güven sınıfı). */
export const SOURCE_LABELS = {
  MACHINE: "Ölçülen",
  OPERATOR: "Elle (operatör)",
  SUPERVISOR: "Elle (amir)",
  SIMULATED: "Simüle",
  INFERRED: "Çıkarım (boş tezgah)",
} as const;
export type DataSource = keyof typeof SOURCE_LABELS;
