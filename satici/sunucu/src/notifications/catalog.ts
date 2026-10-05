// BİLDİRİM KATALOĞU — olay türleri, kanallar ve gövde ALLOWLIST'i TEK kaynak: satıcı (giden kutusu), yan
// konteyner (gönderici) ve portal aynı listeyi okur; DB seddi (`bildirim_govde_gecerli`) aynı anahtarları
// taşır (bekçi `test_bildirim_giden_kutusu` ikisini ölçer). Gövdede talep metni, ek, sağlık ayrıntısı,
// kişisel veri için anahtar YOKTUR: yeni alan eklemek bu listeyi + göçteki seddi + bekçiyi birlikte değiştirir.
import type { BildirimKanali, BildirimOlayi } from "@prisma/client";
import { z } from "zod";

export const NOTIFICATION_EVENTS = [
  "DESTEK_TALEBI",
  "KOPYA_SUPHESI",
  "KOPYA_KIRA_REDDI",
  "TASIMA_TALEBI",
  "DR_DEVRI",
  "KURULUM_SESSIZ",
  "KIRA_BITISI_YAKLASIYOR",
  "GECERLILIK_BITISI_YAKLASIYOR",
  "TAKSIT_VADESI_YAKLASIYOR",
  "PLANLI_EYLEM_UYGULANDI",
  "TAKSIT_GECIKTI",
  "DENEME",
  "GUNCELLEME_TAMAMLANDI",
  "GUNCELLEME_GERI_DONDU",
  "GUNCELLEME_BASARISIZ",
  "YEREL_MUDAHALE_SUPHESI",
  "ANAHTAR_SURESI_BITIYOR",
  "UZUN_UFUK_VERILDI",
  "KOK_IMZASI_ACIL",
  "DONANIM_ONAYI_BEKLIYOR",
  "BAKIM_BITISI_YAKLASIYOR",
] as const satisfies readonly BildirimOlayi[];

export const NOTIFICATION_CHANNELS = ["EPOSTA", "TELEGRAM"] as const satisfies readonly BildirimKanali[];

export const NOTIFICATION_STATES = ["BEKLIYOR", "GONDERILIYOR", "GONDERILDI", "HATA", "KAPALI"] as const;

/** Olay başlığı — e-posta konusu, Telegram ilk satırı ve portal etiketi. */
export const NOTIFICATION_TITLES: Readonly<Record<BildirimOlayi, string>> = {
  DESTEK_TALEBI: "Yeni destek talebi",
  KOPYA_SUPHESI: "Kopya şüphesi uyarısı",
  KOPYA_KIRA_REDDI: "Kopya şüphesi sürüyor — kira verilmedi",
  TASIMA_TALEBI: "Yeni taşıma talebi",
  DR_DEVRI: "DR sunucusu üretimi devraldı",
  KURULUM_SESSIZ: "Kurulum ses vermiyor",
  KIRA_BITISI_YAKLASIYOR: "Kira bitişi yaklaşıyor",
  GECERLILIK_BITISI_YAKLASIYOR: "Lisans geçerlilik bitişi yaklaşıyor",
  TAKSIT_VADESI_YAKLASIYOR: "Taksit vadesi yaklaşıyor",
  PLANLI_EYLEM_UYGULANDI: "Planlı eylem uygulandı",
  TAKSIT_GECIKTI: "Taksit gecikti — kısıtlama başladı",
  DENEME: "Deneme bildirimi",
  GUNCELLEME_TAMAMLANDI: "Sunucu güncellendi",
  GUNCELLEME_GERI_DONDU: "Sunucu güncellemesi geri döndü",
  GUNCELLEME_BASARISIZ: "Sunucu güncellemesi başarısız — müdahale gerekiyor",
  YEREL_MUDAHALE_SUPHESI: "Yerel müdahale şüphesi (lisans izleri)",
  ANAHTAR_SURESI_BITIYOR: "İmza anahtarının süresi bitiyor — dönem töreni zamanı",
  UZUN_UFUK_VERILDI: "Uzun çevrimdışı ufuklu lisans verildi",
  KOK_IMZASI_ACIL: "ACİL kök imzası gerekiyor — fabrika kira alamıyor (yetenek düşüşü)",
  DONANIM_ONAYI_BEKLIYOR: "Donanım değişikliği / zayıf tanıma onay bekliyor",
  BAKIM_BITISI_YAKLASIYOR: "Bakım bitişi yaklaşıyor — yenileme zamanı",
};

/** Gövde ALLOWLIST'i — göçteki `bildirim_govde_gecerli` dizisiyle BİREBİR (sıra dahil). */
export const NOTIFICATION_BODY_KEYS = ["musteri", "tesis", "kurulum", "lisansNo", "sinif", "konu", "referans", "tarih", "portalYolu"] as const;
export type NotificationBodyKey = (typeof NOTIFICATION_BODY_KEYS)[number];

/** Bir gövde değerinin tavanı (DB seddiyle aynı). */
export const BODY_VALUE_MAX = 300;
export const BODY_TOTAL_MAX_BYTES = 2000;
export const PORTAL_PATH_PATTERN = /^\/[a-z0-9/-]{0,200}$/;
/** Tekillik anahtarı: `OLAY:kayıt[:ek]` (DB seddi `bildirim_anahtar_bicimi` ile aynı). */
export const DEDUPE_KEY_PATTERN = /^[A-Z_]{2,40}:[A-Za-z0-9:._-]{1,150}$/;

export type NotificationBody = { readonly [K in Exclude<NotificationBodyKey, "portalYolu">]: string | null } & { readonly portalYolu: string };

const text = z.string().max(BODY_VALUE_MAX).nullable();

/** Göndericinin okuma kapısı: tanınmayan anahtar, biçimsiz yol → gönderilmez (fail-closed). */
export const NotificationBodySchema = z.strictObject({
  musteri: text,
  tesis: text,
  kurulum: text,
  lisansNo: text,
  sinif: text,
  konu: text,
  referans: text,
  tarih: text,
  portalYolu: z.string().regex(PORTAL_PATH_PATTERN),
});

export interface NotificationBodyInput {
  readonly musteri?: string | null;
  readonly tesis?: string | null;
  readonly kurulum?: string | null;
  readonly lisansNo?: string | null;
  readonly sinif?: string | null;
  readonly konu?: string | null;
  readonly referans?: string | null;
  readonly tarih?: Date | null;
  readonly portalYolu: string;
}

/** Eşsiz UTF-16 vekili: jsonb onun kaçışını (\udXXX) REDDEDER (olayın tx'i düşerdi), metin kolonu sessizce değiştirir. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const ELLIPSIS = "…";

/** Kod birimi tavanında keser, vekil çiftini bölmez (kod noktası ≤ kod birimi → DB'nin `char_length`i de tavanda). */
function cutUnits(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, /[\uD800-\uDBFF]/.test(value[max - 1] ?? "") ? max - 1 : max);
}

/** Eşsiz vekil U+FFFD olur, kontrol karakterleri boşluğa iner, metin tavana kırpılır: gövde tek satırlık etiketlerdir. */
function clip(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const flat = value.replace(LONE_SURROGATE, "�").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat === "" ? null : cutUnits(flat, BODY_VALUE_MAX);
}

/** Bir JSON dizgisinin PostgreSQL çıktısındaki UTF-8 bayt boyu (tırnaklar dahil; kaçış kuralı PG'nin `escape_json`ı). */
function pgJsonStringBytes(value: string): number {
  let n = 2;
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x22 || c === 0x5c || c === 0x08 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d) n += 2;
    else if (c < 0x20) n += 6;
    else n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * DB seddinin ölçtüğü boy: `octet_length(govde::text)` — jsonb metni `{"a": "b", "c": null}` biçimindedir (iki nokta ve
 * virgülden sonra boşluk), yani `JSON.stringify`ten anahtar başına ~2 bayt uzun. Kod bu ölçüyle sığdırır.
 */
export function pgJsonbTextBytes(body: Readonly<Record<string, string | null>>): number {
  const entries = Object.entries(body);
  let n = 2 + Math.max(0, entries.length - 1) * 2;
  for (const [k, v] of entries) n += pgJsonStringBytes(k) + 2 + (v === null ? 4 : pgJsonStringBytes(v));
  return n;
}

/** Değeri `maxBytes`e (PG ölçüsü, tırnak dahil) sığacak biçimde kod noktası sınırında keser, sonuna "…" koyar. */
function shrinkTo(value: string, maxBytes: number): string | null {
  if (maxBytes < 8) return null;
  const room = maxBytes - (pgJsonStringBytes(ELLIPSIS) - 2);
  let used = 2;
  let out = "";
  for (const ch of value) {
    const w = pgJsonStringBytes(ch) - 2;
    if (used + w > room) break;
    used += w;
    out += ch;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

const SHRINKABLE_KEYS = ["musteri", "tesis", "kurulum", "lisansNo", "sinif", "konu", "referans"] as const;

/**
 * Gövde DB tavanını (PG ölçüsüyle) aşarsa metin alanları KISALTILIR, reddedilmez: bildirim iş olayını ASLA düşürmez.
 * Su doldurma: kısa alan olduğu gibi kalır, uzun alanlar kalan bütçeyi eşit paylaşır (yol ve tarih dokunulmaz).
 */
function fitBody(body: NotificationBody): NotificationBody {
  if (pgJsonbTextBytes(body) <= BODY_TOTAL_MAX_BYTES) return body;
  const out: Record<string, string | null> = { ...body };
  const sized = SHRINKABLE_KEYS.flatMap((k) => (body[k] === null ? [] : [{ k, bytes: pgJsonStringBytes(body[k]) }])).sort((a, b) => a.bytes - b.bytes);
  let budget = BODY_TOTAL_MAX_BYTES - (pgJsonbTextBytes(body) - sized.reduce((s, x) => s + x.bytes, 0));
  sized.forEach((x, i) => {
    const share = Math.floor(budget / (sized.length - i));
    const value = body[x.k] as string;
    const next = x.bytes <= share ? value : shrinkTo(value, share);
    out[x.k] = next;
    budget -= next === null ? 4 : pgJsonStringBytes(next);
  });
  if (pgJsonbTextBytes(out) <= BODY_TOTAL_MAX_BYTES) return out as NotificationBody;
  // Ulaşılamaz (bütçe yol + tarih + anahtarlar için her zaman yeter) — yine de olay düşmesin: etiketsiz gövde.
  for (const k of SHRINKABLE_KEYS) out[k] = null;
  return out as NotificationBody;
}

/**
 * ALLOWLIST kurucu — yalnız beyanlı anahtarlar, her zaman aynı sırada. Çağıran ne verirse versin gövdeye
 * başka alan GİRMEZ (girdi tipi zaten yalnız bunları taşır; çalışma anında da fazlası yok sayılır). İçerik
 * kaynaklı hata FIRLATMAZ (eşsiz vekil, kontrol karakteri, geçersiz tarih, boy): gövde DB seddinden her zaman geçer.
 */
export function notificationBody(input: NotificationBodyInput): NotificationBody {
  if (!PORTAL_PATH_PATTERN.test(input.portalYolu)) throw new Error(`Bildirim portal yolu biçimsiz: ${input.portalYolu}`);
  const tarih = input.tarih && !Number.isNaN(input.tarih.getTime()) ? input.tarih.toISOString() : null;
  return fitBody({
    musteri: clip(input.musteri),
    tesis: clip(input.tesis),
    kurulum: clip(input.kurulum),
    lisansNo: clip(input.lisansNo),
    sinif: clip(input.sinif),
    konu: clip(input.konu),
    referans: clip(input.referans),
    tarih,
    portalYolu: input.portalYolu,
  });
}

/** Tekillik anahtarı: olay öneki + parçalar (biçim DB seddiyle aynı; aşan parça kurucuda reddedilir). */
export function dedupeKey(event: BildirimOlayi, ...parts: readonly (string | number)[]): string {
  const key = [event, ...parts.map(String)].join(":");
  if (!DEDUPE_KEY_PATTERN.test(key)) throw new Error(`Bildirim tekillik anahtarı biçimsiz: ${key}`);
  return key;
}
