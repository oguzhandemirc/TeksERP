// Donanım değişikliği bildirimi (K8): panelin "Donanım değişikliğini bildir" düğmesi, imzalı istek (`amac:
// donanim`) ile `POST /v1/donanim`e — çevrimdışıyken aynı istek zarfla QR yolundan. Güçlü etkenler tutuyorsa
// satıcı yeni kümeyi kendiliğinden öğrenir ve yeni kira döner; tutmuyorsa portal onay kuyruğuna düşer.
import { z } from "zod";
import { FingerprintSchema, PROTOCOL_VERSION, UuidSchema } from "./belgeler";
import { LicenseResponseSchema, LostFactorListSchema } from "./uclar";

export const HARDWARE_REPORT_REASON_MAX = 500;

/** İstek gövdesi KATI: ölçülen tuzlu küme, kayıp etkenler ve kullanıcının gerekçesi — iş verisi yok. */
export const HardwareReportRequestSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  parmakIzi: FingerprintSchema,
  kayip: LostFactorListSchema,
  gerekce: z.string().trim().max(HARDWARE_REPORT_REASON_MAX).nullable(),
});
export type HardwareReportRequest = z.infer<typeof HardwareReportRequestSchema>;

/** `ONAYLANDI` (kendiliğinden ya da portal onayıyla) yeni kümeyi taşıyan kirayla gelir; öteki iki durum lisanssız. */
export const HARDWARE_REPORT_STATES = ["BEKLIYOR", "ONAYLANDI", "REDDEDILDI"] as const;
export type HardwareReportState = (typeof HARDWARE_REPORT_STATES)[number];

/** Yanıt gevşek (taşıma talebi kalıbı): `lisans` yalnız `ONAYLANDI`da dolu. */
export const HardwareReportResponseSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    talepId: UuidSchema,
    durum: z.enum(HARDWARE_REPORT_STATES),
    lisans: LicenseResponseSchema.nullable(),
  })
  .refine((r) => (r.durum === "ONAYLANDI") === (r.lisans !== null), { message: "Lisans yalnız onaylı bildirimde döner" });
export type HardwareReportResponse = z.infer<typeof HardwareReportResponseSchema>;
