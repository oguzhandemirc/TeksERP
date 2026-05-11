import { z } from "zod";
import { CompanyType } from "@/types/enums";

export const customerFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(200),
  taxNumber: z.string().max(40).optional().or(z.literal("")),
  type: z.enum([CompanyType.CUSTOMER, CompanyType.SUPPLIER]),
  isActive: z.boolean(),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const customerFormDefaults: CustomerFormValues = {
  name: "",
  taxNumber: "",
  type: CompanyType.CUSTOMER,
  isActive: true,
};
