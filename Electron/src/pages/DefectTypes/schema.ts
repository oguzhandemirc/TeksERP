import { z } from "zod";
import { DefectSeverity } from "@/types/enums";

export const defectTypeFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  severity: z
    .enum([DefectSeverity.MINOR, DefectSeverity.MAJOR, DefectSeverity.CRITICAL])
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
});

export type DefectTypeFormValues = z.infer<typeof defectTypeFormSchema>;

export const defectTypeFormDefaults: DefectTypeFormValues = {
  name: "",
  description: "",
  severity: "",
  isActive: true,
};
