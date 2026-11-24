// =============================================================================
// MALİYET ROTALARI ortak gövde şemaları (/api/cost) — iplik fiyatı + makine saat ücreti
// =============================================================================
// `cost.routes.ts` satır tavanını aşmasın diye ayrıldı; uçlar ve izinler orada kalır.
// =============================================================================
import { z } from "zod";

export const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"], { message: "Geçersiz para birimi" });
// Sayı metin ya da sayı gelir; Decimal'e çevirme + aralık servis tarafında (`cost-input.helper`).
export const decimalInput = z.union([z.string(), z.number()]);

export const yarnPriceSchema = z.object({
  yarnItemId: z.string().uuid("Geçersiz iplik ID"),
  currency: currencyEnum,
  pricePerKg: decimalInput,
  source: z.enum(["MANUAL", "LAST_RECEIPT", "PURCHASE_PRICE"], { message: "Geçersiz fiyat kaynağı" }).optional(),
  sourceRef: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
}).strict();

// Damgalı sürüm, "şu andan itibaren"; yaratma/değişim `clientToken` taşır (replay tek boğaz, servis).
export const clientTokenField = z.string().uuid("Geçersiz istemci anahtarı (clientToken)");
export const revokeBody = z.object({ reason: z.string().trim().max(300, "Gerekçe en çok 300 karakter").nullable().optional() }).strict();
const machineRateValues = {
  hourRateTry: decimalInput,
  normMPerHour: decimalInput.nullable().optional(),
  note: z.string().nullable().optional(),
  clientToken: clientTokenField,
};
export const machineRateCreateSchema = z.object({ machineId: z.string().uuid("Geçersiz makine ID"), ...machineRateValues }).strict();
export const machineRateChangeSchema = z.object(machineRateValues).strict();
