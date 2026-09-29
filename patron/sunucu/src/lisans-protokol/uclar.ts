// Satıcı uçlarının gövde sözleşmesi (v:1). İstek gövdeleri KATI (tanınmayan anahtar RED:
// yoklama iş verisi taşımaz, allowlist'in dışı sessizce sızamaz); yanıt gövdeleri
// GEVŞEK (sunucu v:1 içinde yeni bilgi alanı ekleyebilir, eski kurulum yok sayar).
import { z } from "zod";
import {
  PublicKeyXSchema,
  IsoTimeSchema,
  JwsTextSchema,
  FingerprintSchema,
  PROTOCOL_VERSION,
  VersionTextSchema,
  UuidSchema,
} from "./belgeler";

export const ENDPOINTS = {
  ACTIVATE: "/v1/etkinlestir",
  POLL: "/v1/yokla",
  DOORBELL: "/v1/zil",
  OFFLINE: "/v1/cevrimdisi",
  TRANSFER: "/v1/tasima",
  DR_TAKEOVER: "/v1/dr-devral",
  SUPPORT: "/v1/destek",
} as const;

export const VALIDITY_VALUES = ["GECERLI", "GECERSIZ", "OLCULEMEDI"] as const;
export type Validity = (typeof VALIDITY_VALUES)[number];
/** Şiddet sırasıyla: dizideki sıra karşılaştırmada kullanılır. */
export const STATE_TIERS = ["NORMAL", "UYARI", "EK_SURE", "KISITLI", "DURDURULMUS"] as const;
export type StateTier = (typeof STATE_TIERS)[number];
export const LICENSE_MODES = ["gozlem", "zorla"] as const;
export type LicenseMode = (typeof LICENSE_MODES)[number];

export const POLL_DEFAULT_MINUTES = 60;
export const DOORBELL_HEARTBEAT_SECONDS = 25;
export const DOORBELL_EVENT_NAME = "zil";
export const DOORBELL_TOPICS = ["lisans", "gelen-kutusu", "ozet", "rapor", "guncelleme", "destek"] as const;
export const DoorbellEventSchema = z.object({ konu: z.enum(DOORBELL_TOPICS) });

/** Crockford base32: I/L/O/U yok — elle yazımda karışmaz. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_BLOCK = `[${CODE_ALPHABET}]{4}`;
export const ActivationCodeSchema = z.string().regex(new RegExp(`^TKS-${CODE_BLOCK}-${CODE_BLOCK}-${CODE_BLOCK}$`));

/** Kullanıcının yazdığı kodu kanonik biçime getirir (büyük harf, O→0, I/L→1, tire yerleşimi). */
export function normalizeActivationCode(text: string): string {
  const alnum = text.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const body = (alnum.length === 15 && alnum.startsWith("TKS") ? alnum.slice(3) : alnum)
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (body.length !== 12) return text.trim().toUpperCase();
  return `TKS-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export const EnvironmentSchema = z.strictObject({
  platform: z.enum(["win32", "linux", "darwin"]),
  mimari: z.enum(["x64", "arm64"]),
  isletimSistemi: z.string().max(120),
  nodeSurum: z.string().regex(/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  uygulamaSurum: VersionTextSchema,
  derlemeTarihi: IsoTimeSchema.nullable(),
  konteyner: z.boolean(),
});

const CounterSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ShortCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * Sağlık özeti ALLOWLIST'i: yalnız sayılar ve kapalı kümeler. Ham hata metni, dosya adı,
 * kullanıcı adı, iş verisi GİRMEZ — serbest metin alanı bilerek yok.
 */
export const HealthSummarySchema = z.strictObject({
  surum: VersionTextSchema,
  calismaSn: CounterSchema,
  dbBoyutBayt: CounterSchema.nullable(),
  yedek: z.strictObject({
    hukum: z.enum(["ok", "uyari", "kritik", "yapilandirilmamis"]),
    yasSaat: z.number().min(0).max(1e6).nullable(),
  }),
  offsite: z.strictObject({ yapilandirildi: z.boolean(), ok: z.boolean().nullable(), eksikSayisi: CounterSchema.nullable() }),
  diskDolulukYuzde: z.number().min(0).max(100).nullable(),
  auditYazmaHatasi: CounterSchema,
  havuzZamanAsimi: CounterSchema,
  istemciler: z.array(z.strictObject({ tur: z.enum(["panel", "tablet", "web", "diger"]), surum: VersionTextSchema, adet: CounterSchema })).max(50),
  isHatalari: z.array(z.strictObject({ is: ShortCodeSchema, adet: CounterSchema })).max(50),
});

export const StateSummarySchema = z.strictObject({
  gecerlilik: z.enum(VALIDITY_VALUES),
  nedenler: z.array(z.string().regex(/^[A-Z0-9_]{2,40}$/)).max(40),
  kip: z.enum(LICENSE_MODES),
  hesaplananKademe: z.enum(STATE_TIERS),
  uygulananKademe: z.enum(STATE_TIERS),
});

const VersionField = z.literal(PROTOCOL_VERSION);

export const ActivateRequestSchema = z.strictObject({
  v: VersionField,
  kod: ActivationCodeSchema,
  kurulumId: UuidSchema,
  acikAnahtar: PublicKeyXSchema,
  parmakIzi: FingerprintSchema,
  ortam: EnvironmentSchema,
});

export const PollRequestSchema = z.strictObject({
  v: VersionField,
  /** Kira zinciri: sunucu ucu tutar; geride kalmış uç "yakala", iki farklı parmak izi "kopya şüphesi". */
  sonKiraId: UuidSchema.nullable(),
  hak: z.strictObject({ hakId: UuidSchema, surum: z.number().int().min(1) }).nullable(),
  parmakIzi: FingerprintSchema,
  durum: StateSummarySchema,
  saat: z.strictObject({ duvar: IsoTimeSchema, guvenilir: IsoTimeSchema, bulgu: z.enum(["SAAT_ILERI", "SAAT_GERI"]).nullable() }),
  ortam: EnvironmentSchema,
  saglik: HealthSummarySchema,
  /** Gözlem kipinde zorlamanın REDDEDECEĞİ istek/modül sayısı (sıfır-fark ölçümü). */
  gozlem: z.strictObject({ reddedilecekIstek: CounterSchema, reddedilecekModul: CounterSchema }),
});

export const TransferRequestSchema = z.strictObject({
  v: VersionField,
  kurulumId: UuidSchema,
  acikAnahtar: PublicKeyXSchema,
  parmakIzi: FingerprintSchema,
  ortam: EnvironmentSchema,
  gerekce: z.string().max(500).nullable(),
});

export const DrTakeoverRequestSchema = z.strictObject({
  v: VersionField,
  anaKurulumId: UuidSchema,
  gerekce: z.string().min(1).max(500),
});

export const OfflineRequestSchema = z.strictObject({ v: VersionField, zarf: z.string().min(1).max(64 * 1024) });

/** Etkinleştir · yokla · çevrimdışı · DR yanıtı. `hak` yalnız değiştiyse (ya da kurulumda yoksa) gelir. */
export const LicenseResponseSchema = z.object({
  v: VersionField,
  hak: JwsTextSchema.nullable(),
  kira: JwsTextSchema,
  indirmeBelirtecleri: z.array(z.object({ yolOneki: z.string().max(80), belirtec: JwsTextSchema })).max(4),
  sunucuSaati: IsoTimeSchema,
});

export const TransferResponseSchema = z.object({
  v: VersionField,
  talepId: UuidSchema,
  durum: z.enum(["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"]),
  lisans: LicenseResponseSchema.nullable(),
});

/** Satıcının `details.code` değerleri (protokol doğrulama kodları da aynen dönebilir). */
export const VENDOR_ERROR_CODES = [
  "GOVDE_GECERSIZ",
  "PROTOKOL_SURUMU",
  "ISTEK_GECERSIZ",
  "ISTEK_TEKRAR",
  "KURULUM_BILINMIYOR",
  "KURULUM_IPTAL",
  "ETKINLESTIRME_KODU_GECERSIZ",
  "ETKINLESTIRME_KODU_KULLANILMIS",
  "TASIMA_ONAYI_BEKLIYOR",
  "KIRA_VERILMEDI",
  "HIZ_SINIRI",
  /** 409: eşzamanlı işlem çakıştı (40001/40P01, atomik claim kaybı) — aynı istek yeniden denenebilir. */
  "TEKRAR_DENEYIN",
  /** 404: satıcıda böyle bir yol yok (adres yanlış ya da sunucu sürümü eski). */
  "BULUNAMADI",
  "SUNUCU_HATASI",
] as const;
export type VendorErrorCode = (typeof VENDOR_ERROR_CODES)[number];

export const VendorErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  details: z.object({ code: z.string() }),
});

export type ActivateRequest = z.infer<typeof ActivateRequestSchema>;
export type PollRequest = z.infer<typeof PollRequestSchema>;
export type LicenseResponse = z.infer<typeof LicenseResponseSchema>;
export type HealthSummary = z.infer<typeof HealthSummarySchema>;
