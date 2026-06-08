import { z } from "zod";

export const colorFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Renk adı boş bırakılamaz")
    .max(80, "Renk adı en fazla 80 karakter olabilir"),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk kodu #RRGGBB formatında olmalı (örn. #1A2B3C)")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
  /** Rengin atandığı müşteriler (firmaya özel renk). Boş = ortak renk. */
  customerIds: z.array(z.string()).default([]),
});

export type ColorFormValues = z.infer<typeof colorFormSchema>;

export const colorFormDefaults: ColorFormValues = {
  name: "",
  hex: "",
  isActive: true,
  customerIds: [],
};
