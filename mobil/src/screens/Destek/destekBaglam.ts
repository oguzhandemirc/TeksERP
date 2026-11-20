// =============================================================================
// Destek talebinin otomatik bağlamı (kullanıcıya SORULMAZ)
// =============================================================================
// Giren: ekran adı/anahtarı, uygulama sürümü + yapı kodu, cihaz modeli, Android
// sürümü, cihaz türü, varsa son API hatası. GİRMEZ: parola, PIN, token, cihaz
// kimliği, sunucu adresi, istek gövdesi. Bağlam katıdır (bilinmeyen üst alan →
// 400) ve ≤ 16 KB'tır; yalnız sözleşmedeki üst alanlar kullanılır.
// =============================================================================

import type { DestekBaglam } from '../../services/destek.service';

export interface LastError {
  /** ISO zaman. */
  at: string;
  method: string;
  /** Yalnız yol; sorgu dizesi ATILMIŞ. */
  path: string;
  status: number | 'AG' | 'ZAMAN_ASIMI';
  message: string;
}

export interface ContextInput {
  ekranAdi: string | null;
  ekranAnahtari: string | null;
  surum: string;
  yapiKodu: number;
  /** RN `Platform.constants` (Android: Model, Manufacturer, Release). */
  platform: { os: string; version: string | number; constants?: Record<string, unknown> };
  cihazTuru: 'tablet' | 'phone';
  lastError: LastError | null;
}

const metin = (v: unknown, azami: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, azami) : undefined;

export function cihazAdi(constants: Record<string, unknown> | undefined): string | undefined {
  const uretici = metin(constants?.Manufacturer, 60);
  const model = metin(constants?.Model, 80);
  if (uretici && model) {
    return model.toLowerCase().startsWith(uretici.toLowerCase()) ? model : `${uretici} ${model}`;
  }
  return model ?? uretici;
}

export function destekBaglami(g: ContextInput): DestekBaglam {
  const androidVersion = metin(g.platform.constants?.Release, 20);
  const os =
    g.platform.os === 'android'
      ? `Android ${androidVersion ?? '?'} (API ${String(g.platform.version)})`
      : `${g.platform.os} ${String(g.platform.version)}`;
  const technical: Record<string, unknown> = {
    yapiKodu: g.yapiKodu,
    cihazTuru: g.cihazTuru === 'tablet' ? 'Tablet' : 'El terminali / telefon',
  };
  if (g.ekranAnahtari) technical.ekranAnahtari = g.ekranAnahtari.slice(0, 100);
  if (g.lastError) {
    technical.lastError = {
      at: g.lastError.at,
      istek: `${g.lastError.method} ${g.lastError.path}`.slice(0, 300),
      durum: g.lastError.status,
      mesaj: g.lastError.message.slice(0, 500),
    };
  }
  const baglam: DestekBaglam = {
    client: {
      os,
      device: cihazAdi(g.platform.constants),
      appVersion: `${g.surum} (${g.yapiKodu})`,
      locale: 'tr-TR',
    },
    technical,
  };
  if (g.ekranAdi) baglam.screen = g.ekranAdi.slice(0, 200);
  if (g.ekranAnahtari) baglam.path = `/saha/${g.ekranAnahtari}`.slice(0, 500);
  return baglam;
}

/** Modül olmayan rotaların Türkçe adı (modüller izin kataloğundan çözülür). */
const EK_EKRAN_ADLARI: Record<string, string> = {
  ModuleSelect: 'Bölüm Seçimi',
  SevkiyatGecmisi: 'Sevkiyat Geçmişi',
  SevkiyatDetay: 'Sevkiyat Detayı',
  Paketleme: 'Çuval Havuzu',
  CuvalDuzelt: 'Çuval Düzelt',
  HizliSiparis: 'Hızlı Sipariş',
  KartelaSevkGecmisi: 'Kartela Sevk Geçmişi',
  KartelaKabulGecmisi: 'Kartela Kabul Geçmişi',
  FasonSevkGecmisi: 'Fason Sevk Geçmişi',
  IadeGecmisi: 'İade Geçmişi',
  Settings: 'Ayarlar',
};

export function ekranAdiBul(
  anahtar: string | null | undefined,
  katalog: Record<string, { label: string } | undefined>,
): string | null {
  if (!anahtar) return null;
  return katalog[anahtar]?.label ?? EK_EKRAN_ADLARI[anahtar] ?? anahtar;
}

/** URL'den yalnız yol: sorgu ve parça atılır (sorguda kişisel veri olabilir). */
export function yalnizYol(url: string | undefined): string {
  if (!url) return '?';
  return url.split(/[?#]/)[0].slice(0, 200) || '?';
}
