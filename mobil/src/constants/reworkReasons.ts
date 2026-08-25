// =============================================================================
// YENİDEN ÜRETİM SEBEPLERİ — çevrimdışı zemin (2026-08-25)
// =============================================================================
// Depodaki BİTMİŞ bir topu tekrar üretime/boyahaneye alırken operatörün seçtiği
// sebep. Sunucudaki `constants/reason-presets.ts → REWORK_REASONS` ile BİREBİR
// aynı liste ve aynı SIRA olmalı — bu dosya yalnız katalog okunamadığında
// (ilk açılış / sunucu erişilemez) devreye giren zemindir.
//
// ⚠️ KODLAR GERÇEK: diğer iki metin-saklayan listede zemin `BUILTIN_*` uydurma
// kodları taşır ve sunucu kodu METİNDEN türetir. Burada öyle DEĞİL — bu kind
// metin saklamaz, kodu istemci gönderir ve o kod rapor anahtarıdır. Uydurma kod
// göndermek `parameters.rework.reasonCode`u çöpe çevirirdi.
//
// ⚠️ Sebep İSTEĞE BAĞLIDIR: hiçbiri seçilmeden iş emri başlatılabilir.
// =============================================================================

export interface ReworkReasonPreset {
  readonly code: string;
  readonly label: string;
  /** true → seçilince serbest metin ZORUNLU (istemci "Diğer"i böyle bilir). */
  readonly requiresText?: boolean;
}

export const REWORK_REASON_PRESETS: readonly ReworkReasonPreset[] = [
  { code: 'TON_TUTMADI', label: 'Ton tutmadı' },
  { code: 'LEKE', label: 'Leke / kir' },
  { code: 'MUSTERI_IADESI', label: 'Müşteri iadesi' },
  { code: 'RENK_DEGISIKLIGI', label: 'Renk değişikliği' },
  { code: 'KALITE_DUSUK', label: 'Kalite düşük' },
  { code: 'DIGER', label: 'Diğer', requiresText: true },
] as const;
