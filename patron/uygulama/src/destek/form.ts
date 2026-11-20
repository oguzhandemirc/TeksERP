// Destek talep formu — saf doğrulama, gövde kurma ve clientToken kararı.
// clientToken SÖZLEŞMESİ (bulut §6.2): form açılınca BİR KEZ üretilir (mantıksal deneme = bu form); sonucu belirsiz
// hata (ağ · zaman aşımı · 5xx) ve 429'da AYNI token (merkez aynı talebi döner, ikinci talep açılmaz); kesin 4xx'te
// TAZE token (kullanıcı formu düzeltir, yeni deneme). Üretici `api/attempt.newId` (UUID; `[A-Za-z0-9_.:-]` içinde).
import { ApiError } from "../api/client";
import { newId } from "../api/attempt";
import type { DestekBaglam, DestekDosya, DestekTalep, DestekTur, TalepAcGovde } from "../api/destek-wire";
import { belirsizMi } from "./metin";

export const KONU_AZAMI = 200;
export const MESAJ_AZAMI = 20_000;

export interface DestekFormDegeri {
  readonly tur: DestekTur | null;
  readonly konu: string;
  readonly mesaj: string;
}

export interface FormHatalari {
  tur?: string;
  konu?: string;
  mesaj?: string;
}

export function formuDogrula(f: DestekFormDegeri): FormHatalari {
  const h: FormHatalari = {};
  if (!f.tur) h.tur = "Talep türünü seçin";
  const konu = f.konu.trim();
  if (!konu) h.konu = "Konu yazın";
  else if (konu.length > KONU_AZAMI) h.konu = `Konu en çok ${KONU_AZAMI} karakter olabilir`;
  const mesaj = f.mesaj.trim();
  if (!mesaj) h.mesaj = "Sorunu kısaca anlatın";
  else if (mesaj.length > MESAJ_AZAMI) h.mesaj = `Mesaj en çok ${MESAJ_AZAMI} karakter olabilir`;
  return h;
}

export function hataYokMu(h: FormHatalari): boolean {
  return !h.tur && !h.konu && !h.mesaj;
}

/** Yanıt kutusu: 1–20 000 karakter (kırpılmış). */
export function yanitGecerliMi(metin: string): boolean {
  const t = metin.trim();
  return t.length > 0 && t.length <= MESAJ_AZAMI;
}

export function yeniToken(gen: () => string = newId): string {
  return gen();
}

/** Gönderim düştükten sonra hangi token'la devam edilir? */
export function hataSonrasiToken(onceki: string, err: unknown, gen: () => string = newId): string {
  if (belirsizMi(err)) return onceki;
  if (err instanceof ApiError && err.status === 429) return onceki;
  return gen();
}

/** `data:image/jpeg;base64,XXXX` → düz `XXXX` (sözleşme: `data:` öneki YOK); düz base64 aynen döner. */
export function duzBase64(v: string | null | undefined): string | null {
  if (!v) return null;
  const i = v.indexOf("base64,");
  const b = (v.startsWith("data:") ? (i < 0 ? "" : v.slice(i + "base64,".length)) : v).replace(/\s+/g, "");
  return b.length > 0 ? b : null;
}

export interface GovdeGirdisi {
  readonly form: DestekFormDegeri;
  readonly clientToken: string;
  readonly baglam: DestekBaglam;
  /** Ekran görüntüsü (düz base64 JPEG) — yoksa yalnız metinli talep. */
  readonly ekranJpegBase64: string | null;
}

/** Doğrulanmış formdan POST gövdesi. Kimlik alanı (user/tenant) GÖNDERİLMEZ (bulut gövdesi KATI). */
export function talepGovdesi(g: GovdeGirdisi): TalepAcGovde {
  const ek = duzBase64(g.ekranJpegBase64);
  const files: DestekDosya[] = ek ? [{ name: "ekran.jpg", contentType: "image/jpeg", dataBase64: ek }] : [];
  return {
    type: g.form.tur ?? "BUG",
    subject: g.form.konu.trim(),
    message: g.form.mesaj.trim(),
    clientToken: g.clientToken,
    context: g.baglam,
    ...(files.length > 0 ? { files } : {}),
  };
}

/** Belirsiz hatadan sonra: yeniden okunan talepte bizim metnimizle yeni bir CUSTOMER mesajı var mı? */
export function yanitIslendiMi(once: number, t: DestekTalep | null, metin: string): boolean {
  if (!t || t.messages.length <= once) return false;
  return t.messages.slice(once).some((m) => m.kind === "CUSTOMER" && m.body.trim() === metin.trim());
}
