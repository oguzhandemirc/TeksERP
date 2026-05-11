import { z } from "zod";

export const subcontractorCategoryFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(80),
  description: z.string().max(300).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type SubcontractorCategoryFormValues = z.infer<typeof subcontractorCategoryFormSchema>;

export const subcontractorCategoryFormDefaults: SubcontractorCategoryFormValues = {
  name: "",
  description: "",
  isActive: true,
};
