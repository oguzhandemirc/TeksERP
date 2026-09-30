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

/** Kontrol karakterleri boşluğa iner, metin tavana kırpılır: gövde tek satırlık etiketlerdir. */
function clip(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat === "" ? null : flat.slice(0, BODY_VALUE_MAX);
}

/**
 * ALLOWLIST kurucu — yalnız beyanlı anahtarlar, her zaman aynı sırada. Çağıran ne verirse versin gövdeye
 * başka alan GİRMEZ (girdi tipi zaten yalnız bunları taşır; çalışma anında da fazlası yok sayılır).
 */
export function notificationBody(input: NotificationBodyInput): NotificationBody {
  if (!PORTAL_PATH_PATTERN.test(input.portalYolu)) throw new Error(`Bildirim portal yolu biçimsiz: ${input.portalYolu}`);
  const body: NotificationBody = {
    musteri: clip(input.musteri),
    tesis: clip(input.tesis),
    kurulum: clip(input.kurulum),
    lisansNo: clip(input.lisansNo),
    sinif: clip(input.sinif),
    konu: clip(input.konu),
    referans: clip(input.referans),
    tarih: input.tarih ? input.tarih.toISOString() : null,
    portalYolu: input.portalYolu,
  };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > BODY_TOTAL_MAX_BYTES) throw new Error("Bildirim gövdesi 2000 baytı aşıyor");
  return body;
}

/** Tekillik anahtarı: olay öneki + parçalar (biçim DB seddiyle aynı; aşan parça kurucuda reddedilir). */
export function dedupeKey(event: BildirimOlayi, ...parts: readonly (string | number)[]): string {
  const key = [event, ...parts.map(String)].join(":");
  if (!DEDUPE_KEY_PATTERN.test(key)) throw new Error(`Bildirim tekillik anahtarı biçimsiz: ${key}`);
  return key;
}
