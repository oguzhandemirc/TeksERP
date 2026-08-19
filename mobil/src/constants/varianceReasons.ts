// =============================================================================
// ÜRETİM SAPMASI — SEBEP KATALOĞU (mobil AYNA, 2026-08-09)
// =============================================================================
// ⚠️ Bu dosya `Teks-Erp/src/constants/variance-reasons.ts`'in AYNASIDIR.
// Mobil bağımsız bir projedir ve backend'i import EDEMEZ (`types/permissions.ts`
// ile aynı durum). Kod eklerken İKİ DOSYAYI da güncelle.
//
// Ayrışma derleme hatası vermez — bu yüzden backend bekçisi
// `scripts/test_roll_variance.ts` iki listenin BİREBİR aynı olduğunu dosyayı
// okuyarak doğrular. Ayrışırsa test kırmızı verir.
//
// NEDEN HAZIR SEÇENEK: `manualReasons.ts` ile aynı gerekçe — eldivenli operatör
// vardiya ortasında metin yazmıyor, "aaa" yazıyor ve o boş bırakmaktan kötüdür.
// ⚠️ Sahada sürekli "Diğer" seçiliyorsa katalog YANLIŞTIR; listeyi büyütme,
// gerçek serbest metinlere bakıp seçenekleri düzelt.
// =============================================================================

export interface VarianceReason {
  code: string;
  label: string;
  /** true → serbest metin de istenir (`reasonText` zorunlu olur). */
  requiresText?: boolean;
}

/** FİRE — mal VARDI, kullanılamaz. Gerçek üretim kaybı. */
export const SCRAP_REASONS: readonly VarianceReason[] = [
  // ⚠️ SIRA ANLAMLIDIR: en sık seçilen sebep BAŞTA (2026-08-19 saha talebi).
  { code: 'TOP_BASI', label: 'Top başı' },
  { code: 'DOKUMA_HATASI', label: 'Dokuma hatası' },
  { code: 'BOYA_HATASI', label: 'Boya / renk hatası' },
  { code: 'LEKE', label: 'Leke / kirlenme' },
  { code: 'YIRTIK', label: 'Yırtık / delik' },
  { code: 'EN_HATASI', label: 'En hatası' },
  { code: 'MAKINE_HASARI', label: 'Makine kaynaklı hasar' },
  { code: 'DIGER', label: 'Diğer', requiresText: true },
];

/**
 * KAYIT DÜZELTMESİ — mal HİÇ YOKTU, kayıt yanlıştı. Fire DEĞİLDİR.
 *
 * ⚠️ Operatöre bu ayrım ekranda AÇIKÇA anlatılmalı ("bu metraj fiziksel olarak
 * yoktu"). Yanlış kovaya atılan her satır fire oranını şişirir.
 */
export const RECORD_CORRECTION_REASONS: readonly VarianceReason[] = [
  { code: 'OLCUM_HATASI', label: 'Ölçüm hatası (metre yanlış okundu)' },
  { code: 'GIRIS_FAZLA', label: 'Girişte fazla metraj yazılmış' },
  { code: 'MUKERRER_KAYIT', label: 'Mükerrer kayıt' },
  { code: 'YANLIS_TOP', label: 'Yanlış top okutulmuş' },
  { code: 'DIGER', label: 'Diğer', requiresText: true },
];

/** Serbest metnin alt sınırı — backend `VARIANCE_MIN_REASON_TEXT` ile aynı. */
export const VARIANCE_MIN_REASON_TEXT = 3;

/**
 * Kalan-metraj kararı → sapma türü.
 * `keep_*` sapma DEĞİLDİR (kalan gerçek bir top olarak stoğa girer).
 */
export type RemainingAction = 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard';

export function reasonsForAction(action: RemainingAction): readonly VarianceReason[] {
  if (action === 'scrap') return SCRAP_REASONS;
  if (action === 'discard') return RECORD_CORRECTION_REASONS;
  return [];
}

/** Seçim geçerli mi — backend'in aynısı, ekranda "Kaydet"i kapamak için. */
export function isVarianceReasonValid(
  action: RemainingAction,
  code: string | null,
  text: string | null,
): boolean {
  const catalog = reasonsForAction(action);
  if (catalog.length === 0) return true;
  if (!code) return false;
  const hit = catalog.find((r) => r.code === code);
  if (!hit) return false;
  if (hit.requiresText) return (text ?? '').trim().length >= VARIANCE_MIN_REASON_TEXT;
  return true;
}
