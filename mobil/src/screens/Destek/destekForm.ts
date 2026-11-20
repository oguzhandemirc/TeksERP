// =============================================================================
// Destek talep formu — saf doğrulama, gövde kurma ve clientToken kararı
// =============================================================================
// clientToken SÖZLEŞMESİ (DESTEK-ENTEGRASYONU.md §5.2, MOBIL.md [MO-09]):
//   • form açılınca BİR KEZ üretilir (mantıksal deneme = bu form);
//   • sonucu belirsiz hata (ağ / zaman aşımı / 5xx) → AYNI token (merkez aynı
//     talebi döner, ikinci talep açılmaz);
//   • kesin 4xx → TAZE token (kullanıcı formu düzeltir, yeni deneme);
//   • 429 kesin değildir (hiçbir şey yazılmadı ama aynı istek geçerli) → AYNI.
// Üretici `offline/entryAttempt.freshEntryIdentity` — repodaki tek kaynak.
// =============================================================================

import { freshEntryIdentity } from '../../offline/entryAttempt';
import type { DestekBaglam, DestekFile, DestekTur, CreateTicketBody } from '../../services/destek.service';
import { belirsizMi } from './destekMetin';

export const KONU_AZAMI = 200;
export const MESAJ_AZAMI = 20_000;

export interface DestekFormValue {
  tur: DestekTur | null;
  konu: string;
  mesaj: string;
}

export interface FormErrors {
  tur?: string;
  konu?: string;
  mesaj?: string;
}

export function formuDogrula(f: DestekFormValue): FormErrors {
  const h: FormErrors = {};
  if (!f.tur) h.tur = 'Talep türünü seçin.';
  const konu = f.konu.trim();
  if (!konu) h.konu = 'Konu yazın.';
  else if (konu.length > KONU_AZAMI) h.konu = `Konu en çok ${KONU_AZAMI} karakter olabilir.`;
  const mesaj = f.mesaj.trim();
  if (!mesaj) h.mesaj = 'Sorunu kısaca anlatın.';
  else if (mesaj.length > MESAJ_AZAMI) h.mesaj = `Mesaj en çok ${MESAJ_AZAMI} karakter olabilir.`;
  return h;
}

export function hasNoErrors(h: FormErrors): boolean {
  return !h.tur && !h.konu && !h.mesaj;
}

/** Yanıt kutusu: 1–20 000 karakter (kırpılmış). */
export function isReplyValid(metin: string): boolean {
  const t = metin.trim();
  return t.length > 0 && t.length <= MESAJ_AZAMI;
}

export function yeniToken(gen?: () => string): string {
  return freshEntryIdentity(gen).clientToken;
}

/** Gönderim düştükten sonra hangi token'la devam edilir? */
export function tokenAfterError(onceki: string, err: unknown, gen?: () => string): string {
  if (belirsizMi(err)) return onceki;
  if ((err as { status?: number } | null)?.status === 429) return onceki;
  return yeniToken(gen);
}

export interface BodyInput {
  form: DestekFormValue;
  clientToken: string;
  baglam: DestekBaglam;
  /** Ekran görüntüsü (düz base64 JPEG) — yoksa yalnız metinli talep. */
  ekranJpegBase64: string | null;
}

/** `data:image/jpeg;base64,XXXX` → düz `XXXX` (sözleşme: `data:` öneki YOK). */
export function dataUriBase64(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const i = uri.indexOf('base64,');
  if (!uri.startsWith('data:') || i < 0) return null;
  const b = uri.slice(i + 'base64,'.length).replace(/\s+/g, '');
  return b.length > 0 ? b : null;
}

/** Doğrulanmış formdan POST gövdesi. Kimlik alanı (user/tenant) GÖNDERİLMEZ. */
export function buildTicketBody(g: BodyInput): CreateTicketBody {
  const files: DestekFile[] = g.ekranJpegBase64
    ? [{ name: 'ekran.jpg', contentType: 'image/jpeg', dataBase64: g.ekranJpegBase64 }]
    : [];
  return {
    type: g.form.tur ?? 'BUG',
    subject: g.form.konu.trim(),
    message: g.form.mesaj.trim(),
    clientToken: g.clientToken,
    context: g.baglam,
    ...(files.length > 0 ? { files } : {}),
  };
}
