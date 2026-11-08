// Hizmet kartı — sade form. Kart ayrı tabloda (`service_items`, D1b); kumaşa özgü alanlar (denye, çözgü/atkı
// kartı, izinli renk/özellik) YOK. Boş kod → sunucu HZM-NNNNNN verir; STK-/HZM- öneki elle yazılamaz (sunucu da reddeder).
import { z } from "zod";
import { ITEM_UNIT_CODES } from "@/lib/item-unit";

const codeSchema = z
  .string()
  .trim()
  .max(32, "Kod en fazla 32 karakter olabilir")
  .regex(/^[A-Za-z0-9_-]*$/, "Kod sadece harf, rakam, tire (-) ve alt çizgi (_) içerebilir")
  .refine((v) => !/^(stk|hzm)-/i.test(v), "STK- ve HZM- önekleri otomatik kodlara ayrılmıştır — boş bırakın, sistem versin");

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

/** Gövde `.strict()` (yalnız code · name · unit · isActive): tür alanı YOK; düzenlemede kod gönderilmez (sunucu korur). */
export function servicePayload(v: ServiceFormValues, isEdit: boolean) {
  const base = { name: v.name.trim(), unit: v.unit };
  if (isEdit) return base;
  return { ...base, ...(v.code.trim() ? { code: v.code.trim() } : {}) };
}
