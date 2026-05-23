import { z } from "zod";

export const subcontractorCategoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Kategori adı boş bırakılamaz")
    .max(80, "Kategori adı en fazla 80 karakter olabilir"),
  description: z
    .string()
    .max(300, "Açıklama en fazla 300 karakter olabilir")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
  appliesColor: z.boolean(),
  appliesProperty: z.boolean(),
});

export type SubcontractorCategoryFormValues = z.infer<typeof subcontractorCategoryFormSchema>;

export const subcontractorCategoryFormDefaults: SubcontractorCategoryFormValues = {
  name: "",
  description: "",
  isActive: true,
  appliesColor: false,
  appliesProperty: false,
};
