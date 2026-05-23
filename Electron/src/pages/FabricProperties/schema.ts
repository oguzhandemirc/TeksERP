import { z } from "zod";

export const fabricPropertyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Özellik adı boş bırakılamaz")
    .max(80, "Özellik adı en fazla 80 karakter olabilir"),
  category: z
    .string()
    .max(60, "Kategori adı en fazla 60 karakter olabilir")
    .optional()
    .or(z.literal("")),
  description: z
    .string()
    .max(300, "Açıklama en fazla 300 karakter olabilir")
    .optional()
    .or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk kodu #RRGGBB formatında olmalı (örn. #1A2B3C)")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
});

export type FabricPropertyFormValues = z.infer<typeof fabricPropertyFormSchema>;

export const fabricPropertyFormDefaults: FabricPropertyFormValues = {
  name: "",
  category: "",
  description: "",
  color: "",
  isActive: true,
};
