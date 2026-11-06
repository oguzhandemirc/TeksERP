// Hizmet kartı — sade form (K3, 2026-11-06). Hizmet de bir `Item`dır (`itemType: SERVICE`); kumaşa özgü
// alanlar (denye, çözgü/atkı kartı, izinli renk/özellik) burada YOK. Kod kuralı Ürünler formuyla aynı.
import { z } from "zod";
import { ITEM_UNIT_CODES } from "@/lib/item-unit";

const codeSchema = z
  .string()
  .trim()
  .max(32, "Kod en fazla 32 karakter olabilir")
  .regex(/^[A-Za-z0-9_-]*$/, "Kod sadece harf, rakam, tire (-) ve alt çizgi (_) içerebilir")
  .refine((v) => !/^stk-/i.test(v), "STK- öneki otomatik kodlara ayrılmıştır — boş bırakın, sistem versin");

export const serviceFormSchema = z.object({
  code: codeSchema,
  name: z
    .string()
    .trim()
    .min(1, "Hizmet adı boş bırakılamaz")
    .max(100, "Hizmet adı en fazla 100 karakter olabilir"),
  unit: z.enum(ITEM_UNIT_CODES as [string, ...string[]], { message: "Birim seçilmeli" }),
});

export type ServiceFormValues = z.infer<typeof serviceFormSchema>;

export const serviceFormDefaults: ServiceFormValues = { code: "", name: "", unit: "MT" };

/** Yeni kayıtta tür SERVICE sabittir; düzenlemede kod ve tür gönderilmez (backend kodu korur). */
export function servicePayload(v: ServiceFormValues, isEdit: boolean) {
  const base = { name: v.name.trim(), unit: v.unit };
  if (isEdit) return base;
  return { ...base, itemType: "SERVICE" as const, ...(v.code.trim() ? { code: v.code.trim() } : {}) };
}
