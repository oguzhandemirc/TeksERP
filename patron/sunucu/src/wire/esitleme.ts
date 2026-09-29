// EŞİTLEME TEL SÖZLEŞMESİ — fabrika ↔ patron bulutu TEK KAYNAK (docs/design/PATRON-BULUTU-ESITLEME.md §6–§8, §17).
// Fabrikada BAYT-EŞİT aynası `Teks-Erp/src/cloud-sync/wire/esitleme.ts` (bekçi `test_bulut_tel_aynasi`); yalnız `zod`
// içe aktarır ki iki projede de derlensin. İstek gövdeleri KATI (tanınmayan anahtar ⇒ 400 GOVDE_GECERSIZ), yanıtlar
// GEVŞEK (yeni bilgi alanı eklenebilir, eski fabrika yok sayar). Anahtarlar ve kod değerleri Türkçe.
import { z } from "zod";

/** Eşitleme sözleşmesi sürümü (N). Bulut N ve N−1'i kabul eder; N−1'e `FABRIKA_SURUMU_ESKI` uyarısı döner. */
export const SYNC_CONTRACT_VERSION = 1;
export const ENVELOPE_VERSION = 1;

/** Paket sınırları (§5): sıkıştırılmış ≤ 4 MB · açılmış ≤ 32 MB (sıkıştırma bombası) · ≤ 5.000 kayıt. */
export const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_RECORDS_PER_PACKAGE = 5000;

/** Fabrika kanalı uçları — hepsi POST, kurulum imzalı (`X-TKL-Istek`, amaç `esitle`). */
export const SYNC_PATHS = {
  SYNC: "/v1/esitle",
  INBOX_CLAIM: "/v1/gelen-kutusu/al",
  INBOX_RESULT: "/v1/gelen-kutusu/sonuc",
  ACCOUNTS: "/v1/hesaplar",
  REPORT_CLAIM: "/v1/rapor/al",
  REPORT_RESULT: "/v1/rapor/sonuc",
} as const;
export type SyncPath = (typeof SYNC_PATHS)[keyof typeof SYNC_PATHS];

/** Gövdesi gzip'li giden uçlar (S14); diğerleri küçük yoklamadır ve sıkıştırılmaz. Bulut ikisini de kabul eder. */
export const GZIP_PATHS: readonly SyncPath[] = [SYNC_PATHS.SYNC, SYNC_PATHS.REPORT_RESULT];

/**
 * Fabrika kanalının (`/v1/*`) `details.code` değerleri (§6.7 + §17); gövde `{success:false, message:<TR>, details:{code}}`.
 * Bunlara ek olarak protokol kodları (`JWS_*`, `ISTEK_*`, 401) olduğu gibi geçer. Bulutun kod listesi bu kümeyi İÇERİR.
 */
export const FACTORY_CHANNEL_ERROR_CODES = [
  "GOVDE_GECERSIZ",
  "PROTOKOL_SURUMU",
  "ISTEK_GECERSIZ",
  "KURULUM_BILINMIYOR",
  "KURULUM_IPTAL",
  "HIZ_SINIRI",
  "TEKRAR_DENEYIN",
  "BULUNAMADI",
  "SUNUCU_HATASI",
  "SINIF_GONDEREMEZ",
  "PATRON_BULUT_KAPALI",
  "SOZLESME_ESKI",
  "SOZLESME_BILINMIYOR",
  "PAKET_ISLENIYOR",
  "PAKET_BUYUK",
  "PAKET_KIMLIGI_CAKISTI",
  "DURUM_CAKISMASI",
  "RAPOR_BILINMIYOR",
] as const;
export type FactoryChannelErrorCode = (typeof FACTORY_CHANNEL_ERROR_CODES)[number];
export const CloudErrorResponseSchema = z.object({ success: z.literal(false), message: z.string(), details: z.looseObject({ code: z.string() }) });

const Iso = z.iso.datetime();
const Uuid = z.uuid();
const Code = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/);
const ProjectionName = z.string().max(80).regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/);
const WireKey = /^[A-Za-z][A-Za-z0-9]*$/;

/** `k` turun sıra sayacıdır: TAM 12 hane, sözlük sırası = sayı sırası (fabrika metin, bulut sayı olarak karşılaştırır; ikisi aynı sırayı verir). */
export const WatermarkSchema = z.strictObject({ t: Iso, k: z.string().regex(/^\d{12}$/) });
export type Watermark = z.infer<typeof WatermarkSchema>;

// ---------------------------------------------------------------- eşitleme paketi (§6.2)

/** Kayıt satırı: `id` zorunlu; iç alanları bulut bilmez (kolon listesinin tek kaynağı fabrika kataloğu), saklar. */
export const RecordRowSchema = z
  .looseObject({ id: Uuid })
  .refine((r) => Object.keys(r).every((k) => WireKey.test(k)), "Tel alan adı harfle başlar, harf/rakam taşır");

export const DELETE_REASONS = ["SILINDI", "KAPSAM_DISI"] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];
export const SYNC_ROUND_KINDS = ["ARTIMLI", "TAM", "UZLASTIRMA"] as const;
export type SyncRoundKind = (typeof SYNC_ROUND_KINDS)[number];

export const RecordEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  katalogSurum: z.number().int().min(1).max(1000),
  yaz: z.array(RecordRowSchema).max(MAX_RECORDS_PER_PACKAGE),
  sil: z.array(z.strictObject({ id: Uuid, neden: z.enum(DELETE_REASONS) })).max(MAX_RECORDS_PER_PACKAGE),
  /** TAM'ın İLK parçası zinciri sıfırdan kurar: `onceki: null` (S15). */
  filigran: z.strictObject({ onceki: WatermarkSchema.nullable(), yeni: WatermarkSchema }),
  tam: z
    .strictObject({ parca: z.number().int().min(1), toplamParca: z.number().int().min(1).max(100000), baslangic: Iso })
    .refine((t) => t.parca <= t.toplamParca, "parca toplamParca'yı aşamaz")
    .nullable(),
});
export type RecordEntry = z.infer<typeof RecordEntrySchema>;

export const SnapshotEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  /** `veri`nin sha256'sı (hex) — aynı içerik ikinci kez gönderilmez. */
  icerikOzeti: z.string().regex(/^[0-9a-f]{64}$/),
  veri: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
});
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

/**
 * Küme özeti: `md5(COALESCE(string_agg(id::text, ',' ORDER BY id), ''))` — uuid tip sırası, virgül, küçük harf;
 * BOŞ küme `md5('')`dir, `null` değil (iki uç aynı biçimde özetler; aksi hâlde boş projeksiyon her gün TAM ister).
 */
export const EMPTY_SET_DIGEST = "d41d8cd98f00b204e9800998ecf8427e";
export const ReconcileEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  adet: z.number().int().min(0),
  ozet: z.string().regex(/^[0-9a-f]{32}$/),
  ufukTarihi: Iso.nullable(),
});
export type ReconcileEntry = z.infer<typeof ReconcileEntrySchema>;

export const PackageSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  sozlesme: z.number().int().min(0).max(1000),
  paketId: Uuid,
  kurulumId: Uuid,
  tur: z.enum(SYNC_ROUND_KINDS),
  ufuk: Iso,
  uretimBilgisi: z.strictObject({ uygulamaSurum: z.string().min(1).max(40), katalogSurum: z.number().int().min(1).max(1000) }),
  kayitlar: z.array(RecordEntrySchema).max(200),
  anliklar: z.array(SnapshotEntrySchema).max(100),
  uzlastirma: z.array(ReconcileEntrySchema).max(200),
});
export type SyncPackage = z.infer<typeof PackageSchema>;

/** Girdi reddinin kodları (`ret[].kod`); kod EKLEMEK kırıcı değildir (fabrika yanıtı gevşek okur). */
export const ENTRY_REJECT_CODES = ["PROJEKSIYON_BILINMIYOR", "PROJEKSIYON_TURU", "KATALOG_SURUMU", "ALAN_SINIFI_IHLALI", "TAM_PARCA_UYUSMAZ"] as const;
export type EntryRejectCode = (typeof ENTRY_REJECT_CODES)[number];
/** Tam gönderim isteğinin nedenleri (`istenen[].neden`). */
export const FULL_REQUEST_REASONS = ["FILIGRAN_KOPUK", "KATALOG_SURUMU", "UZLASTIRMA"] as const;
export type FullRequestReason = (typeof FULL_REQUEST_REASONS)[number];

/** Bulutun ürettiği yanıt (KATI tip) — fabrika bunu `SyncResponseSchema` ile GEVŞEK okur. */
export interface SyncResponse {
  readonly v: 1;
  readonly paketId: string;
  readonly kabul: { projeksiyon: string; filigran: Watermark }[];
  readonly ret: { projeksiyon: string; kod: EntryRejectCode }[];
  readonly istenen: { projeksiyon: string; tur: "TAM"; neden: FullRequestReason }[];
  readonly ufukTarihi: Record<string, string>;
  readonly sozlesmeUyarisi: "FABRIKA_SURUMU_ESKI" | null;
}

export const SyncResponseSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  paketId: Uuid,
  kabul: z.array(z.object({ projeksiyon: z.string(), filigran: z.object({ t: z.string(), k: z.string() }).optional() })).default([]),
  ret: z.array(z.object({ projeksiyon: z.string(), kod: z.string() })).default([]),
  istenen: z.array(z.object({ projeksiyon: z.string(), tur: z.string(), neden: z.string().optional() })).default([]),
  ufukTarihi: z.record(z.string(), Iso.nullable()).default({}),
  sozlesmeUyarisi: z.string().nullable().default(null),
});
/** Fabrikanın okuduğu biçim (varsayılanlar doldurulmuş). */
export type SyncResponseRead = z.infer<typeof SyncResponseSchema>;
/** Derleme kapısı: bulutun ürettiği yanıt fabrikanın okuyucusunu karşılamazsa iki projede de derleme kırılır. */
type Holds<T extends true> = T;
export type SyncResponseConforms = Holds<SyncResponse extends z.input<typeof SyncResponseSchema> ? true : false>;

// ---------------------------------------------------------------- gelen kutusu (§8, §17)

export const INBOX_KINDS = ["SIPARIS", "CARI"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export const INBOX_CLAIM_MAX = 50;
/** Sonuç satırı sınırları — fabrika servis mesajını buluta göndermeden önce bunlara sığdırır. */
export const INBOX_RESULT_MESSAGE_MAX = 500;
export const INBOX_RESULT_DOC_NO_MAX = 60;

/** Fabrikanın ret kodları (§8.6) — bulut kullanıcıya TR mesajla gösterir; 5xx/ağ hatası ret DEĞİLDİR. */
export const INBOX_REJECT_CODES = [
  "GOVDE_GECERSIZ",
  "CARI_AD_MUKERRER",
  "CARI_BULUNAMADI",
  "URUN_BULUNAMADI",
  "RENK_BULUNAMADI",
  "MODUL_KAPALI",
  "MESAJ_CAKISMASI",
  "IS_KURALI",
] as const;
export type InboxRejectCode = (typeof INBOX_REJECT_CODES)[number];

export const InboxClaimRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION), enFazla: z.number().int().min(1).max(INBOX_CLAIM_MAX).default(20) });

export const InboxMessageSchema = z.object({
  mesajId: Uuid,
  tur: z.enum(INBOX_KINDS),
  govde: z.unknown(),
  hesapId: Uuid,
  hesapAdi: z.string().trim().min(1).max(200),
  olusturulma: Iso,
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;
export const InboxClaimResponseSchema = z.object({ v: z.literal(ENVELOPE_VERSION), kayitlar: z.array(InboxMessageSchema).max(INBOX_CLAIM_MAX) });
export type InboxClaimResponse = z.input<typeof InboxClaimResponseSchema>;

export const InboxOutcomeSchema = z
  .strictObject({
    mesajId: Uuid,
    durum: z.enum(["ISLENDI", "REDDEDILDI"]),
    varlikId: Uuid.nullable().optional(),
    belgeNo: z.string().min(1).max(INBOX_RESULT_DOC_NO_MAX).nullable().optional(),
    kod: Code.nullable().optional(),
    mesaj: z.string().min(1).max(INBOX_RESULT_MESSAGE_MAX).nullable().optional(),
  })
  .refine((s) => s.durum !== "REDDEDILDI" || (!!s.kod && !!s.mesaj), "REDDEDILDI sonucu kod ve TR mesaj taşır");
export type InboxOutcome = z.infer<typeof InboxOutcomeSchema>;
export const InboxResultRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION), sonuclar: z.array(InboxOutcomeSchema).min(1).max(INBOX_CLAIM_MAX) });
export const InboxResultResponseSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  kabul: z.array(Uuid).default([]),
  ret: z.array(z.object({ mesajId: Uuid, kod: z.string(), durum: z.string().nullable() })).default([]),
});
export type InboxResultResponse = z.input<typeof InboxResultResponseSchema>;

// ---------------------------------------------------------------- bulut hesap listesi (S29)

export const ACCOUNT_STATES = ["DAVETLI", "AKTIF", "KILITLI", "PASIF"] as const;
export const AccountsRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION) });
export const CloudAccountSchema = z.object({
  id: Uuid,
  ad: z.string().max(200),
  eposta: z.string().max(254).nullable().optional(),
  durum: z.enum(ACCOUNT_STATES),
  sonGiris: Iso.nullable().optional(),
});
export type CloudAccount = z.infer<typeof CloudAccountSchema>;
export const AccountsResponseSchema = z.object({ v: z.literal(ENVELOPE_VERSION), hesaplar: z.array(CloudAccountSchema).max(1000) });
export type AccountsResponse = z.input<typeof AccountsResponseSchema>;

// ---------------------------------------------------------------- rapor isteği (§7, S13, S14)

export const REPORT_CLAIM_MAX = 10;
export const ReportClaimRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION), enFazla: z.number().int().min(1).max(REPORT_CLAIM_MAX).default(3) });
export const ReportClaimResponseSchema = z.object({
  v: z.literal(ENVELOPE_VERSION),
  istekler: z
    .array(z.object({ istekId: Uuid, raporAnahtari: z.string().max(80), parametreler: z.record(z.string(), z.unknown()).default({}), olusturulma: Iso.optional() }))
    .max(REPORT_CLAIM_MAX)
    .default([]),
});
export type ReportClaimResponse = z.input<typeof ReportClaimResponseSchema>;

/** Standart görüntünün dönemi; isteğe bağlı raporda ve kesit raporda `null`. */
export const REPORT_PERIODS = ["bugun", "bu-ay", "gecen-ay"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export const REPORT_RESULT_STATES = ["HAZIR", "HATA"] as const;
export const REPORT_ERROR_CODES = ["RAPOR_BILINMIYOR", "PARAMETRE_GECERSIZ", "ZAMAN_ASIMI", "RAPOR_KAPALI", "MODUL_KAPALI", "SONUC_BUYUK"] as const;

export const ReportResultRequestSchema = z
  .strictObject({
    v: z.literal(ENVELOPE_VERSION),
    /** `null` = fabrikanın kendi ürettiği standart görüntü (istek yok) — bulut `report_results`e yazar (S13). */
    istekId: Uuid.nullable(),
    raporAnahtari: z.string().min(1).max(80),
    parametreler: z.record(z.string(), z.unknown()),
    donem: z.enum(REPORT_PERIODS).nullable(),
    durum: z.enum(REPORT_RESULT_STATES),
    veri: z.unknown().nullable(),
    hataKodu: z.enum(REPORT_ERROR_CODES).nullable(),
    hesaplandi: Iso,
    kaynakUfuk: Iso,
  })
  .refine((r) => (r.durum === "HAZIR" ? r.veri !== null && r.veri !== undefined && r.hataKodu === null : r.hataKodu !== null && r.veri === null), {
    message: "HAZIR veri taşır, HATA yalnız hataKodu taşır",
  });
export type ReportResult = z.infer<typeof ReportResultRequestSchema>;
export const ReportResultResponseSchema = z.object({ v: z.literal(ENVELOPE_VERSION), kabul: z.boolean(), durum: z.string() });
export type ReportResultResponse = z.input<typeof ReportResultResponseSchema>;

// ---------------------------------------------------------------- gelen kutusu MESAJ gövdeleri (§8.5; KATI)
// Alan kümesi fabrikanın yaratma yolunun ALT kümesidir; sınırlar fabrika kolonlarından (bulut yazarken 400 verir ki
// fabrikanın her seferinde reddedeceği mesaj kuyruğa hiç girmesin). `aciklama`/`vergiDairesi` yok (S27).

/** Miktar/en `Decimal(12,3)`, birim fiyat `Decimal(12,2)` — sayı ondalık DİZİ olarak gelir, float'a düşmez. */
const Quantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Miktar en çok 9 tam, 3 ondalık haneli DİZİ olarak gelir");
const Price = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Fiyat en çok 10 tam, 2 ondalık haneli DİZİ olarak gelir");
const ShortText = (max: number) => z.string().trim().min(1).max(max);

export const OrderMessageSchema = z.strictObject({
  cariKartId: Uuid,
  subeId: Uuid.optional(),
  /** Takvim günü (fabrika günü, Europe/Istanbul) — saat taşımaz. */
  termin: z.iso.date().optional(),
  doviz: z.string().regex(/^[A-Z]{3}$/),
  kalemler: z
    .array(
      z.strictObject({
        urunId: Uuid,
        renkId: Uuid.optional(),
        miktar: Quantity,
        birim: z.string().regex(/^[A-Z]{2,8}$/).optional(),
        birimFiyat: Price.optional(),
        en: Quantity.optional(),
        musteriUrunAdi: ShortText(200).optional(),
        musteriRenkAdi: ShortText(200).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type OrderMessage = z.infer<typeof OrderMessageSchema>;

export const CustomerMessageSchema = z.strictObject({
  ad: ShortText(100),
  roller: z.strictObject({ musteri: z.boolean(), tedarikci: z.boolean() }).refine((r) => r.musteri || r.tedarikci, "En az bir rol seçilmeli"),
  il: ShortText(80).optional(),
  ilce: ShortText(80).optional(),
  ulke: ShortText(80).optional(),
  vergiNo: z.string().regex(/^[0-9]{10,11}$/).optional(),
  adres: ShortText(500).optional(),
  yetkili: ShortText(120).optional(),
  telefon: z.string().regex(/^[0-9 +()-]{7,25}$/).optional(),
  eposta: z.email().max(200).optional(),
});
export type CustomerMessage = z.infer<typeof CustomerMessageSchema>;
