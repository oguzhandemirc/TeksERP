// =============================================================================
// Destek — saf metin ve hata eşlemesi (sözleşme §4, §5)
// =============================================================================
// Karar `details.code` ile verilir (`body.code` yok); 4xx'te backend `message`ı
// zaten kullanıcıya gösterilebilir Türkçe metindir. Burada yalnız istemcinin
// KENDİ cümlesini kurması gereken durumlar (ağ, merkez erişilemez, 429, 413…)
// eşlenir.
// =============================================================================

import type { DestekDurum, DestekEk, DestekTur } from '../../services/destek.service';

export const AYDINLATMA = 'Destek talepleri Etkili Yazılım destek sisteminde işlenir.';

export const TUR_ETIKET: Record<DestekTur, string> = {
  BUG: 'Hata',
  QUESTION: 'Soru',
  REQUEST: 'İstek',
};

export const DURUM_ETIKET: Record<DestekDurum, string> = {
  NEW: 'Yeni',
  IN_PROGRESS: 'İnceleniyor',
  WAITING_CUSTOMER: 'Sizden bilgi bekleniyor',
  ANSWERED: 'Yanıtlandı',
  CLOSED: 'Kapandı',
};

/** Rozet tonu — renk jetonu seçimi görünümde yapılır. */
export type StatusTone = 'info' | 'warning' | 'success' | 'muted';
export const STATUS_TONE: Record<DestekDurum, StatusTone> = {
  NEW: 'info',
  IN_PROGRESS: 'info',
  WAITING_CUSTOMER: 'warning',
  ANSWERED: 'success',
  CLOSED: 'muted',
};

/** Durum bilinmiyorsa (merkez yeni durum eklerse) ham değer gösterilir — çökme yok. */
export function durumEtiketi(s: string): string {
  return (DURUM_ETIKET as Record<string, string>)[s] ?? s;
}

export function boyutMetni(bayt: number): string {
  if (!Number.isFinite(bayt) || bayt < 0) return '—';
  if (bayt < 1024) return `${bayt} B`;
  if (bayt < 1024 * 1024) return `${Math.round(bayt / 1024)} KB`;
  return `${(bayt / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function silinmisEkMetni(ek: Pick<DestekEk, 'name' | 'size'>): string {
  return `Ek süresi dolduğu için silindi · ${ek.name} · ${boyutMetni(ek.size)}`;
}

interface ErrorLike {
  status?: number;
  message?: string;
  details?: { code?: string; retryAfterSec?: unknown };
}

/** Sonucu BELİRSİZ hata mı (ağ yok / zaman aşımı / 5xx)? Aynı token'la yeniden denenir. */
export function belirsizMi(err: unknown): boolean {
  const s = (err as ErrorLike | null)?.status;
  return s === undefined || s >= 500;
}

/** Hata kodu (`details.code`). */
export function errorCode(err: unknown): string | undefined {
  const c = (err as ErrorLike | null)?.details?.code;
  return typeof c === 'string' ? c : undefined;
}

function beklemeMetni(sn: number): string {
  if (sn >= 60) return `${Math.ceil(sn / 60)} dakika sonra tekrar deneyin.`;
  if (sn > 0) return `${sn} saniye sonra tekrar deneyin.`;
  return 'Biraz sonra tekrar deneyin.';
}

/** Kullanıcıya gösterilecek sade Türkçe hata metni. */
export function destekErrorText(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  const kod = errorCode(err);
  if (e.status === undefined) {
    return 'Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.';
  }
  switch (kod) {
    case 'DESTEK_ULASILAMADI':
    case 'DESTEK_ZAMAN_ASIMI':
      return 'Destek merkezine ulaşılamadı, tekrar deneyin.';
    case 'DESTEK_YAPILANDIRMA':
      return 'Destek bağlantısında yapılandırma sorunu var. Sistem yöneticinize bildirin.';
    case 'RATE_LIMITED':
      return `Çok fazla istek gönderildi. ${beklemeMetni(Number(e.details?.retryAfterSec) || 0)}`;
    case 'MODULE_DISABLED':
      return 'Destek bu fabrikada kapalı.';
    case 'NOT_FOUND':
      return 'Talep bulunamadı.';
    case 'REOPEN_WINDOW_EXPIRED':
      return 'Bu talep kapanalı 14 günden fazla oldu. Lütfen yeni talep açın.';
    case 'PAYLOAD_TOO_LARGE':
    case 'ATTACHMENT_TOO_LARGE':
      return 'Ekran görüntüsü çok büyük. Görüntüyü kaldırıp tekrar deneyin.';
    default:
      break;
  }
  if (e.status === 413) return 'Ekran görüntüsü çok büyük. Görüntüyü kaldırıp tekrar deneyin.';
  if (e.status === 429) return `Çok fazla istek gönderildi. ${beklemeMetni(0)}`;
  if (e.status >= 500) return 'Destek merkezine ulaşılamadı, tekrar deneyin.';
  return e.message || 'İşlem tamamlanamadı.';
}
