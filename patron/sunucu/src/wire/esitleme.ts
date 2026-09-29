// EŞİTLEME TEL ŞEMALARI — fabrika ↔ bulut (sözleşme docs/design/PATRON-BULUTU-ESITLEME.md §6–§8).
// İstek gövdeleri KATI (`strictObject`: tanınmayan anahtar ⇒ 400 GOVDE_GECERSIZ); yanıtlar GEVŞEK
// (yeni bilgi alanı eklenebilir, eski fabrika yok sayar). Kayıt satırının İÇİ bulutça bilinmez
// (kolon listesinin tek kaynağı fabrika kataloğu) → yalnız `id` zorunlu, gerisi saklanır.
// Anahtarlar ve kod DEĞERLERİ Türkçe; bildirim adları İngilizce.
import { z } from "zod";

/** Eşitleme sözleşmesi sürümü (N). Bulut N ve N−1'i kabul eder; N−1'e `FABRIKA_SURUMU_ESKI` uyarısı döner. */
export const SYNC_CONTRACT_VERSION = 1;
export const ENVELOPE_VERSION = 1;

/** Paket sınırları (§5): sıkıştırılmış ≤ 4 MB · açılmış ≤ 32 MB (sıkıştırma bombası) · ≤ 5.000 kayıt. */
export const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_RECORDS_PER_PACKAGE = 5000;

export const SYNC_PATHS = {
  SYNC: "/v1/esitle",
  INBOX_CLAIM: "/v1/gelen-kutusu/al",
  INBOX_RESULT: "/v1/gelen-kutusu/sonuc",
  REPORT_CLAIM: "/v1/rapor/al",
  REPORT_RESULT: "/v1/rapor/sonuc",
} as const;

const Iso = z.iso.datetime();
const Uuid = z.uuid();
const ProjectionName = z.string().max(80).regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/);

export const WatermarkSchema = z.strictObject({ t: Iso, k: z.string().min(1).max(120) });
export type Watermark = z.infer<typeof WatermarkSchema>;

/** Kayıt satırı: `id` zorunlu, tel alanları projeksiyona göre (bulut bilmediği alanı saklar, göstermez). */
export const RecordRowSchema = z.looseObject({ id: Uuid });

export const RecordEntrySchema = z
  .strictObject({
    projeksiyon: ProjectionName,
    katalogSurum: z.number().int().min(1).max(1000),
    yaz: z.array(RecordRowSchema).max(MAX_RECORDS_PER_PACKAGE),
    sil: z.array(z.strictObject({ id: Uuid, neden: z.enum(["SILINDI", "KAPSAM_DISI"]) })).max(MAX_RECORDS_PER_PACKAGE),
    filigran: z.strictObject({ onceki: WatermarkSchema.nullable(), yeni: WatermarkSchema }),
    tam: z
      .strictObject({ parca: z.number().int().min(1), toplamParca: z.number().int().min(1).max(100000), baslangic: Iso })
      .refine((t) => t.parca <= t.toplamParca, "parca toplamParca'yı aşamaz")
      .nullable(),
  });
export type RecordEntry = z.infer<typeof RecordEntrySchema>;

export const SnapshotEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  icerikOzeti: z.string().min(1).max(100),
  veri: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
});

export const ReconcileEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  adet: z.number().int().min(0),
  ozet: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
  ufukTarihi: Iso.nullable(),
});

export const PackageSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  sozlesme: z.number().int().min(0).max(1000),
  paketId: Uuid,
  kurulumId: Uuid,
  tur: z.enum(["ARTIMLI", "TAM", "UZLASTIRMA"]),
  ufuk: Iso,
  uretimBilgisi: z.strictObject({ uygulamaSurum: z.string().min(1).max(40), katalogSurum: z.number().int().min(1).max(1000) }),
  kayitlar: z.array(RecordEntrySchema).max(200),
  anliklar: z.array(SnapshotEntrySchema).max(100),
  uzlastirma: z.array(ReconcileEntrySchema).max(200),
});
export type SyncPackage = z.infer<typeof PackageSchema>;

/** Girdi reddinin kodları (`ret[].kod`). */
export const ENTRY_REJECT_CODES = ["PROJEKSIYON_BILINMIYOR", "PROJEKSIYON_TURU", "KATALOG_SURUMU", "ALAN_SINIFI_IHLALI", "TAM_PARCA_UYUSMAZ"] as const;
export type EntryRejectCode = (typeof ENTRY_REJECT_CODES)[number];
/** Tam gönderim isteğinin nedenleri (`istenen[].neden`). */
export const FULL_REQUEST_REASONS = ["FILIGRAN_KOPUK", "KATALOG_SURUMU", "UZLASTIRMA"] as const;
export type FullRequestReason = (typeof FULL_REQUEST_REASONS)[number];

export interface SyncResponse {
  readonly v: 1;
  readonly paketId: string;
  readonly kabul: { projeksiyon: string; filigran: Watermark }[];
  readonly ret: { projeksiyon: string; kod: EntryRejectCode }[];
  readonly istenen: { projeksiyon: string; tur: "TAM"; neden: FullRequestReason }[];
  readonly ufukTarihi: Record<string, string>;
  readonly sozlesmeUyarisi: "FABRIKA_SURUMU_ESKI" | null;
}

// ---------------------------------------------------------------- gelen kutusu (§8)

export const InboxClaimRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION), enFazla: z.number().int().min(1).max(50).default(20) });

export const InboxResultRequestSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  sonuclar: z
    .array(
      z
        .strictObject({
          mesajId: Uuid,
          durum: z.enum(["ISLENDI", "REDDEDILDI"]),
          varlikId: Uuid.nullable().optional(),
          belgeNo: z.string().min(1).max(60).nullable().optional(),
          kod: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).nullable().optional(),
          mesaj: z.string().min(1).max(500).nullable().optional(),
        })
        .refine((s) => s.durum !== "REDDEDILDI" || (!!s.kod && !!s.mesaj), "REDDEDILDI sonucu kod ve TR mesaj taşır"),
    )
    .min(1)
    .max(50),
});

// ---------------------------------------------------------------- rapor isteği (§7)

export const ReportClaimRequestSchema = z.strictObject({ v: z.literal(ENVELOPE_VERSION), enFazla: z.number().int().min(1).max(10).default(3) });

export const ReportResultRequestSchema = z
  .strictObject({
    v: z.literal(ENVELOPE_VERSION),
    istekId: Uuid,
    durum: z.enum(["HAZIR", "HATA"]),
    veri: z.unknown().optional(),
    hataKodu: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
    hesaplandi: Iso,
    kaynakUfuk: Iso.nullable().optional(),
  })
  .refine((r) => (r.durum === "HAZIR" ? r.veri !== undefined && r.hataKodu === undefined : r.hataKodu !== undefined && r.veri === undefined), {
    message: "HAZIR veri taşır, HATA yalnız hataKodu taşır",
  });

// ---------------------------------------------------------------- gelen kutusu MESAJ gövdeleri (§8.5; KATI)

const Decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,6})?$/, "Sayı ondalık DİZİ olarak gelir");
const ShortText = (max: number) => z.string().trim().min(1).max(max);

export const OrderMessageSchema = z.strictObject({
  cariKartId: Uuid,
  subeId: Uuid.optional(),
  termin: z.iso.date().optional(),
  doviz: z.string().regex(/^[A-Z]{3}$/),
  aciklama: ShortText(500).optional(),
  kalemler: z
    .array(
      z.strictObject({
        urunId: Uuid,
        renkId: Uuid.optional(),
        miktar: Decimal,
        birim: z.string().regex(/^[A-Z]{2,8}$/).optional(),
        birimFiyat: Decimal.optional(),
        en: Decimal.optional(),
        musteriUrunAdi: ShortText(200).optional(),
        musteriRenkAdi: ShortText(200).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const CustomerMessageSchema = z.strictObject({
  ad: ShortText(200),
  roller: z.strictObject({ musteri: z.boolean(), tedarikci: z.boolean() }).refine((r) => r.musteri || r.tedarikci, "En az bir rol seçilmeli"),
  il: ShortText(80).optional(),
  ilce: ShortText(80).optional(),
  ulke: ShortText(80).optional(),
  vergiNo: z.string().regex(/^[0-9]{10,11}$/).optional(),
  vergiDairesi: ShortText(120).optional(),
  adres: ShortText(500).optional(),
  yetkili: ShortText(120).optional(),
  telefon: z.string().regex(/^[0-9 +()-]{7,25}$/).optional(),
  eposta: z.email().max(254).optional(),
});

// ---------------------------------------------------------------- satıcı iç API (KURULUM_KAYNAGI=satici)

/** `GET <SATICI_IC_API_URL>/ic/v1/kurulum/:kurulumId` yanıtı (sözleşme §17 — satıcı tarafı ayrı dilim). */
export const VendorInstallationSchema = z.object({
  v: z.literal(1),
  kurulumId: Uuid,
  tesis: z.object({ id: Uuid, ad: z.string().min(1).max(200) }),
  acikAnahtar: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable(),
  sinif: z.enum(["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"]),
  moduller: z.array(z.string().max(64)).max(64),
  patronBulutBitis: Iso.nullable(),
  devredildi: z.boolean(),
  aktif: z.boolean(),
  saklamaAy: z.union([z.literal(3), z.literal(13), z.literal(25), z.null()]).optional(),
});
export type VendorInstallation = z.infer<typeof VendorInstallationSchema>;
