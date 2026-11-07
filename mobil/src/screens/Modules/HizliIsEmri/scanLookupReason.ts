// Okutulan barkodun sunucu sorgusu (GET /rolls/barcode/:b) başarısızsa operatöre giden KISA sebep.
// Eskiden her hata "Okunamadı" diyordu; barkod okunmuş, sorun sunucu cevabındaydı — operatör yanlış şeyi düzeltiyordu.

const NOT_FOUND = 'Top bulunamadı';
const OFFLINE = 'Sunucuya ulaşılamadı';
const GENERIC = 'Sunucu hatası';

export function scanLookupReason(err: unknown): string {
  const e = (err ?? {}) as { status?: unknown; transient?: unknown; message?: unknown };
  if (e.status === 404) return NOT_FOUND;
  // Yanıt yok (ağ / zaman aşımı) ya da vekil kapısı: sebep bağlantıdır, top değil.
  if (typeof e.status !== 'number' || e.transient === 'gateway') return OFFLINE;
  // Diğerlerinde backend'in Türkçe mesajı (yetki, kilit…) — bant iki satır; uzun metin kesilmesin diye sınır.
  const msg = typeof e.message === 'string' ? e.message.trim() : '';
  return msg && msg.length <= 60 ? msg : GENERIC;
}

/** Sunucu 200 döndü ama top yok (eski sürüm sözleşmesi) — 404 ile aynı söz. */
export const SCAN_NOT_FOUND_REASON = NOT_FOUND;
