// =============================================================================
// TEZGAH DURUŞ SEBEPLERİ — çevrimdışı zemin (gömülü, PAZARLIK DIŞI)
// =============================================================================
// Sunucudaki `constants/reason-presets.ts → MACHINE_STOP_REASONS` ile BİREBİR aynı
// kod, etiket ve SIRA (bekçi: `test_loom_stop_zemin`). Yalnız katalog okunamadığında
// devreye girer; zeminsiz kalırsa sebep zorunlu karar kaydedilemez ve tezgah
// ekranda kilitlenir. Kodlar GERÇEK: bu kind metin saklamaz, kod rapor anahtarıdır.
// Kayıp sınıfı burada TAŞINMAZ — sunucu katalogdan kopyalar (`resolveStopPreset`).
// =============================================================================

export interface LoomStopReason {
  readonly code: string;
  readonly label: string;
}

export const LOOM_STOP_REASONS: readonly LoomStopReason[] = [
  { code: 'COZGU_KOPUSU', label: 'Çözgü kopuşu' },
  { code: 'ATKI_KOPUSU', label: 'Atkı kopuşu' },
  { code: 'KENAR_KOPUSU', label: 'Kenar kopuşu' },
  { code: 'IPLIK_BITTI', label: 'İplik bitti' },
  { code: 'MEKANIK_ARIZA', label: 'Mekanik arıza' },
  { code: 'ELEKTRIK_ARIZA', label: 'Elektrik arızası' },
  { code: 'ELEKTRIK_KESINTISI', label: 'Elektrik kesintisi' },
  { code: 'HAVA_BASINCI', label: 'Hava basıncı düştü' },
  { code: 'JAKAR_ARIZA', label: 'Jakar arızası' },
  { code: 'OPERATOR_YOK', label: 'Operatör yok' },
  { code: 'KUMAS_TAMIR', label: 'Kumaş tamiri' },
  { code: 'TESPIT_EDILEMEDI', label: 'Sebep tespit edilemedi' },
  { code: 'LEVENT_BAGLAMA', label: 'Levent bağlama' },
  { code: 'TAHAR', label: 'Tahar' },
  { code: 'TARAK_DEGISIMI', label: 'Tarak değişimi' },
  { code: 'DESEN_DEGISIMI', label: 'Desen değişimi' },
  { code: 'TOP_ALMA', label: 'Top alma' },
  { code: 'PLANLI_BAKIM', label: 'Planlı bakım' },
  { code: 'TEMIZLIK', label: 'Temizlik' },
  { code: 'MOLA', label: 'Mola' },
  { code: 'VARDIYA_DEVRI', label: 'Vardiya devri' },
  { code: 'SIPARIS_YOK', label: 'Sipariş yok' },
  { code: 'TEZGAH_KAPALI', label: 'Tezgah kapalı' },
] as const;
