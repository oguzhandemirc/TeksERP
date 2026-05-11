import { z } from "zod";

export const subcontractorFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(120),
  taxNumber: z.string().max(40).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  isActive: z.boolean(),
  categoryIds: z.array(z.string()).min(1, "En az bir kategori seç"),
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
