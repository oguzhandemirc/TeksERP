import { z } from "zod";

export const subcontractorFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Fason firma adı boş bırakılamaz")
    .max(120, "Fason firma adı en fazla 120 karakter olabilir"),
  taxNumber: z
    .string()
    .max(40, "Vergi numarası en fazla 40 karakter olabilir")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .max(40, "Telefon en fazla 40 karakter olabilir")
    .optional()
    .or(z.literal("")),
  address: z
    .string()
    .max(300, "Adres en fazla 300 karakter olabilir")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
  categoryIds: z
    .array(z.string())
    .min(1, "En az bir fason kategorisi seçilmeli"),
});

export type SubcontractorFormValues = z.infer<typeof subcontractorFormSchema>;

export const subcontractorFormDefaults: SubcontractorFormValues = {
  name: "",
  taxNumber: "",
  phone: "",
  address: "",
  isActive: true,
  categoryIds: [],
};
