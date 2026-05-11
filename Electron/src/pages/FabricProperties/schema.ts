import { z } from "zod";

export const fabricPropertyFormSchema = z.object({
  name: z.string().min(1, "Ad gerekli").max(80),
  category: z.string().max(60).optional().or(z.literal("")),
  description: z.string().max(300).optional().or(z.literal("")),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB formatında olmalı")
    .optional()
    .or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export type FabricPropertyFormValues = z.infer<typeof fabricPropertyFormSchema>;

export const fabricPropertyFormDefaults: FabricPropertyFormValues = {
  name: "",
  category: "",
  description: "",
  color: "",
  sortOrder: 0,
  isActive: true,
};
