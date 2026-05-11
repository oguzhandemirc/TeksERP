import { z } from "zod";

export const colorFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(80),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB formatında olmalı")
    .optional()
    .or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export type ColorFormValues = z.infer<typeof colorFormSchema>;

export const colorFormDefaults: ColorFormValues = {
  name: "",
  hex: "",
  sortOrder: 0,
  isActive: true,
};
