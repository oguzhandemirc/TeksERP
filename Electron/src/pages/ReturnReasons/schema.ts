import { z } from "zod";

export const returnReasonFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Ad boş bırakılamaz")
    .max(100, "Ad en fazla 100 karakter olabilir"),
  description: z.string().trim().max(255, "Açıklama en fazla 255 karakter").optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk kodu #RRGGBB formatında olmalı (örn. #ef4444)")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
});

export type ReturnReasonFormValues = z.infer<typeof returnReasonFormSchema>;

export const returnReasonFormDefaults: ReturnReasonFormValues = {
  name: "",
  description: "",
  color: "",
  isActive: true,
};
