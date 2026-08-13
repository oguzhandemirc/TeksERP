// =============================================================================
// TeksERP - Currency Catalog (sabit liste)
// =============================================================================
// Faz 1'de 4 para birimi yeterli. İleride genişletmek için sadece bu listeye
// ekle — order service whitelist + currencies endpoint otomatik yansır.
// Tam DB tablosuna ihtiyaç olmadan currency yönetimi.
// =============================================================================

export interface CurrencyDef {
  code: string;   // ISO 4217 — order.currency'ye yazılır
  name: string;   // UI'da gösterilen Türkçe isim
  symbol: string; // "₺", "$", "€", "£"
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: "TRY", name: "Türk Lirası",   symbol: "₺" },
  { code: "USD", name: "Amerikan Doları", symbol: "$" },
  { code: "EUR", name: "Euro",           symbol: "€" },
  { code: "GBP", name: "İngiliz Sterlini", symbol: "£" },
  // 2026-08-13 — ticaret paketi: FİYATLAMA için (arayüz dili değişmez, i18n yok).
  { code: "RUB", name: "Rus Rublesi",    symbol: "₽" },
] as const;
