import { z } from "zod";
import type { CustomerBranchPayload } from "./branch-types";

// Uzunluk sınırları DB kolonlarıyla birebir: name VARCHAR(100) / code VARCHAR(50).
export const branchFormSchema = z.object({
  code: z.string().max(50).optional().or(z.literal("")),
  name: z.string().min(1, "Şube adı zorunlu").max(100),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  district: z.string().max(80).optional().or(z.literal("")),
  contactName: z.string().max(120).optional().or(z.literal("")),
  contactPhone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean(),
  defaultDestination: z.enum(["DOMESTIC", "EXPORT"]).nullable(),
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
  defaultDestination: null,
};

/** Form → istek gövdesi; gövdeyi elle kuran katman olduğu için yeni alan BURAYA da eklenir. */
export const branchFormToPayload = (v: BranchFormValues): Partial<CustomerBranchPayload> => ({
  code: v.code?.trim() || null,
  name: v.name.trim(),
  address: v.address?.trim() || null,
  city: v.city?.trim() || null,
  district: v.district?.trim() || null,
  contactName: v.contactName?.trim() || null,
  contactPhone: v.contactPhone?.trim() || null,
  notes: v.notes?.trim() || null,
  isActive: v.isActive,
  defaultDestination: v.defaultDestination,
});
