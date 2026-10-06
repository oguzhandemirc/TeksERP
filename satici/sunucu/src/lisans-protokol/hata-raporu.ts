// Hata raporu kanalı (`POST /v1/hata-raporu`, amaç `hata-raporu`): yalnız müşteri onayıyla, kişisel veri
// taşımayan GRUPLANMIŞ hata özetleri. Gövde KATI allowlist'tir — mesaj metni, istek gövdesi, kullanıcı,
// IP, yol parametresi, mutlak dosya yolu şemadan geçemez; yeni alan iki uçta da sözleşmeye eklenir.
import { createHash } from "node:crypto";
import { z } from "zod";
import { IsoTimeSchema, PROTOCOL_VERSION, UuidSchema, VersionTextSchema } from "./belgeler";

/** Hatanın doğduğu yüzey — istemci hataları da backend üzerinden gelir (istemci dışarı çıkmaz). */
export const ERROR_REPORT_SOURCES = ["sunucu", "panel", "tablet"] as const;
export type ErrorReportSource = (typeof ERROR_REPORT_SOURCES)[number];
/** Bir gönderimdeki en çok grup. */
export const ERROR_REPORT_BATCH_MAX = 50;
/** Grup başına en çok yığın çerçevesi (yalnız dosya:satır). */
export const ERROR_REPORT_STACK_MAX = 8;
export const ERROR_REPORT_COUNT_MAX = 1_000_000;

/** Hata KODU (`details.code`, Prisma kodu, sabit etiket) — büyük harf sabit; serbest metin taşıyamaz. */
export const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,59}$/);
/** Hata SINIFI (`err.name`) — tanımlayıcı biçimi. */
export const ErrorClassSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/);
/** Bileşen/modül — küçük harf kısa etiket. */
export const ErrorComponentSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
/** Yol ŞABLONU parçası: yalnız harf+tire sözcük, `v1` biçimi ya da `:ad` yer tutucusu — kimlik/sayı/kod giremez. */
export const ROUTE_SEGMENT_PATTERN = /^(?:[a-z]+(?:-[a-z]+)*|v\d|:[A-Za-z][A-Za-z0-9]{0,30})$/;
export const RouteTemplateSchema = z
  .string()
  .max(200)
  .refine((s) => s.startsWith("/") && s.length > 1 && s.slice(1).split("/").every((p) => ROUTE_SEGMENT_PATTERN.test(p)), "Yol şablonu değil");
/** Yığın çerçevesi: uygulama köküne GÖRELİ dosya + satır (`src/x/y.ts:12`); mutlak yol, kullanıcı dizini, `..` giremez. */
export const STACK_FRAME_PATTERN = /^(?!.*\.\.)(?!(?:.*\/)?(?:Users|home)\/)[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+){0,4}:\d{1,7}$/;
export const StackFrameSchema = z.string().max(160).regex(STACK_FRAME_PATTERN);

export const ErrorReportEntrySchema = z.strictObject({
  kaynak: z.enum(ERROR_REPORT_SOURCES),
  surum: VersionTextSchema,
  kod: ErrorCodeSchema,
  sinif: ErrorClassSchema,
  bilesen: ErrorComponentSchema,
  yol: RouteTemplateSchema.nullable(),
  yigin: z.array(StackFrameSchema).max(ERROR_REPORT_STACK_MAX),
  ilk: IsoTimeSchema,
  son: IsoTimeSchema,
  sayi: z.number().int().min(1).max(ERROR_REPORT_COUNT_MAX),
});
export type ErrorReportEntry = z.infer<typeof ErrorReportEntrySchema>;

/** `partiId` fabrikanın gönderim kimliğidir: aynı parti ikinci kez gelirse satıcı sayacı İKİNCİ kez artırmaz. */
export const ErrorReportRequestSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  partiId: UuidSchema,
  kayitlar: z.array(ErrorReportEntrySchema).min(1).max(ERROR_REPORT_BATCH_MAX),
  /** Fabrika kuyruğu dolduğu için düşürülen hata SAYISI (içerik yok). */
  dusurulen: z.number().int().min(0).max(ERROR_REPORT_COUNT_MAX),
});
export type ErrorReportRequest = z.infer<typeof ErrorReportRequestSchema>;

export const ErrorReportResponseSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  partiId: UuidSchema,
  kabul: z.number().int().min(0),
});
export type ErrorReportResponse = z.infer<typeof ErrorReportResponseSchema>;

/** Grup kimliği — sayı ve zaman HARİÇ bütün alanlar; fabrika kuyruğu ve satıcı deposu aynı kurucuyu kullanır. */
export function errorReportGroupKey(e: Pick<ErrorReportEntry, "kaynak" | "surum" | "kod" | "sinif" | "bilesen" | "yol" | "yigin">): string {
  const parts = [e.kaynak, e.surum, e.kod, e.sinif, e.bilesen, e.yol ?? "", e.yigin.join(",")];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
