import { z } from "zod";

export const qualityGradeFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(80),
  description: z.string().max(300).optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB formatında olmalı")
    .optional()
    .or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
  targetStatus: z.enum(["WAREHOUSE", "A1_STOCK", "SCRAP"], {
    message: "Hedef durum seçilmeli",
  }),
});

export type QualityGradeFormValues = z.infer<typeof qualityGradeFormSchema>;

export const qualityGradeFormDefaults: QualityGradeFormValues = {
  name: "",
  description: "",
  color: "",
  sortOrder: 0,
  isActive: true,
  targetStatus: "WAREHOUSE",
};
