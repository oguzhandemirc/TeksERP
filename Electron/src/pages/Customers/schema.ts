import { z } from "zod";
import { CompanyType } from "@/types/enums";

export const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Müşteri adı boş bırakılamaz")
    .max(200, "Müşteri adı en fazla 200 karakter olabilir"),
  taxNumber: z
    .string()
    .max(32, "Vergi numarası en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
  type: z.enum([CompanyType.CUSTOMER, CompanyType.SUPPLIER], {
    message: "Müşteri veya tedarikçi seçilmeli",
  }),
  isActive: z.boolean(),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const customerFormDefaults: CustomerFormValues = {
  name: "",
  taxNumber: "",
  type: CompanyType.CUSTOMER,
  isActive: true,
};
