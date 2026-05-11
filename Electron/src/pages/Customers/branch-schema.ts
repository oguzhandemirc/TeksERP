import { z } from "zod";

export const branchFormSchema = z.object({
  code: z.string().max(60).optional().or(z.literal("")),
  name: z.string().min(1, "Şube adı zorunlu").max(120),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  district: z.string().max(80).optional().or(z.literal("")),
  contactName: z.string().max(120).optional().or(z.literal("")),
  contactPhone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type BranchFormValues = z.infer<typeof branchFormSchema>;

export const branchFormDefaults: BranchFormValues = {
  code: "",
  name: "",
  address: "",
  city: "",
  district: "",
  contactName: "",
  contactPhone: "",
  notes: "",
  isActive: true,
};
