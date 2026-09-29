// Eşitleme paketinin TEL sözleşmesi (`docs/design/PATRON-BULUTU-ESITLEME.md` §6): gövde
// KATI (fabrika kendi ürettiğini göndermeden önce bu şemadan geçirir — sözleşmede olmayan
// anahtar dışarı çıkamaz), yanıt GEVŞEK. Sayılar dizi, zamanlar ISO-8601 UTC `Z`.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { SYNC_CONTRACT_VERSION, SYNC_ENVELOPE_VERSION } from "./projections";

export const CLOUD_ENDPOINTS = {
  SYNC: "/v1/esitle",
  REPORT_CLAIM: "/v1/rapor/al",
  REPORT_RESULT: "/v1/rapor/sonuc",
} as const;

/** §5 hacim ölçümü: sıkıştırılmış ≤ 4 MB ve ≤ 5.000 kayıt (hangisi önce dolarsa); açılmış ≤ 32 MB. */
export const PACKET_MAX_GZIP_BYTES = 4 * 1024 * 1024;
export const PACKET_MAX_RECORDS = 5000;
export const PACKET_MAX_RAW_BYTES = 32 * 1024 * 1024;

export const SYNC_ROUND_KINDS = ["ARTIMLI", "TAM", "UZLASTIRMA"] as const;
export type SyncRoundKind = (typeof SYNC_ROUND_KINDS)[number];
export const DELETE_REASONS = ["SILINDI", "KAPSAM_DISI"] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

export type WireScalar = string | number | boolean | null;
export type WireValue = WireScalar | WireValue[] | { [k: string]: WireValue };

/**
 * DB değeri → tel değeri. Decimal DİZİ olarak (float'a düşmez), tarih ISO `Z`, bigint dizi.
 * Tanınmayan nesne tipi FIRLATIR: sessiz `[object Object]` bir sözleşme sızıntısıdır.
 */
export function toWireValue(v: unknown): WireValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Tel değeri sonlu olmayan sayı");
    return v;
  }
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  if (Array.isArray(v)) return v.map(toWireValue);
  if (typeof v === "object") {
    const out: { [k: string]: WireValue } = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = toWireValue(x);
    return out;
  }
  throw new Error(`Tel değerine çevrilemeyen tip: ${typeof v}`);
}

const IsoTime = z.iso.datetime();
const Uuid = z.uuid();
/** Tur sıra sayacı — 12 hane, sözlük sırası = sayı sırası (bulut `{t,k}` çiftini metin olarak karşılaştırır). */
export const WatermarkSchema = z.strictObject({ t: IsoTime, k: z.string().regex(/^\d{12}$/) });
export type WireWatermark = z.infer<typeof WatermarkSchema>;

const ProjectionName = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/);
const WireRow = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), z.unknown()).refine((r) => Uuid.safeParse(r.id).success, {
  message: "Satır uuid `id` taşımalı",
});

export const RecordEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  katalogSurum: z.number().int().min(1),
  yaz: z.array(WireRow),
  sil: z.array(z.strictObject({ id: Uuid, neden: z.enum(DELETE_REASONS) })),
  filigran: z.strictObject({ onceki: WatermarkSchema.nullable(), yeni: WatermarkSchema }),
  tam: z.strictObject({ parca: z.number().int().min(1), toplamParca: z.number().int().min(1), baslangic: IsoTime }).nullable(),
});
export type RecordEntry = z.infer<typeof RecordEntrySchema>;

export const SnapshotEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  icerikOzeti: z.string().regex(/^[0-9a-f]{64}$/),
  veri: z.unknown(),
});
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

export const ReconcileEntrySchema = z.strictObject({
  projeksiyon: ProjectionName,
  adet: z.number().int().min(0),
  ozet: z.string().regex(/^[0-9a-f]{32}$/),
  ufukTarihi: IsoTime.nullable(),
});
export type ReconcileEntry = z.infer<typeof ReconcileEntrySchema>;

export const SyncPacketSchema = z.strictObject({
  v: z.literal(SYNC_ENVELOPE_VERSION),
  sozlesme: z.literal(SYNC_CONTRACT_VERSION),
  paketId: Uuid,
  kurulumId: Uuid,
  tur: z.enum(SYNC_ROUND_KINDS),
  ufuk: IsoTime,
  uretimBilgisi: z.strictObject({ uygulamaSurum: z.string().max(60), katalogSurum: z.number().int().min(1) }),
  kayitlar: z.array(RecordEntrySchema),
  anliklar: z.array(SnapshotEntrySchema),
  uzlastirma: z.array(ReconcileEntrySchema),
});
export type SyncPacket = z.infer<typeof SyncPacketSchema>;

/** Yanıt GEVŞEK: bulut v:1 içinde yeni bilgi alanı ekleyebilir, fabrika yok sayar. */
export const SyncResponseSchema = z.object({
  v: z.literal(SYNC_ENVELOPE_VERSION),
  paketId: Uuid,
  kabul: z.array(z.object({ projeksiyon: z.string(), filigran: z.object({ t: z.string(), k: z.string() }).optional() })).default([]),
  ret: z.array(z.object({ projeksiyon: z.string(), kod: z.string() })).default([]),
  istenen: z.array(z.object({ projeksiyon: z.string(), tur: z.string(), neden: z.string().optional() })).default([]),
  ufukTarihi: z.record(z.string(), IsoTime.nullable()).default({}),
  sozlesmeUyarisi: z.string().nullable().default(null),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;


export const CloudErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  details: z.object({ code: z.string() }),
});

/** Rapor isteği protokolü (§7) — `al` yanıtı GEVŞEK, `sonuc` gövdesi KATI. */
export const ReportClaimResponseSchema = z.object({
  v: z.literal(SYNC_ENVELOPE_VERSION),
  istekler: z
    .array(z.object({ istekId: Uuid, raporAnahtari: z.string().max(80), parametreler: z.record(z.string(), z.unknown()).default({}) }))
    .max(20)
    .default([]),
});

export const REPORT_RESULT_STATES = ["HAZIR", "HATA"] as const;
export const REPORT_ERROR_CODES = ["RAPOR_BILINMIYOR", "PARAMETRE_GECERSIZ", "ZAMAN_ASIMI", "RAPOR_KAPALI", "MODUL_KAPALI", "SONUC_BUYUK"] as const;

export const ReportResultSchema = z.strictObject({
  v: z.literal(SYNC_ENVELOPE_VERSION),
  /** `null` = fabrikanın kendi ürettiği standart dönem anlık görüntüsü (istek yok). */
  istekId: Uuid.nullable(),
  raporAnahtari: z.string().max(80),
  parametreler: z.record(z.string(), z.unknown()),
  /** Standart görüntünün dönemi (`bugun` · `bu-ay` · `gecen-ay`); isteğe bağlı raporda null. */
  donem: z.enum(["bugun", "bu-ay", "gecen-ay"]).nullable(),
  durum: z.enum(REPORT_RESULT_STATES),
  veri: z.unknown().nullable(),
  hataKodu: z.enum(REPORT_ERROR_CODES).nullable(),
  hesaplandi: IsoTime,
  kaynakUfuk: IsoTime,
});
export type ReportResult = z.infer<typeof ReportResultSchema>;
