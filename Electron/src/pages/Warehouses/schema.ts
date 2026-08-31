import { z } from "zod";

export const warehouseFormSchema = z.object({
  name: z.string().trim().min(1, "Ad boş bırakılamaz").max(100, "Ad en fazla 100 karakter olabilir"),
  address: z.string().trim().max(300, "Adres en fazla 300 karakter").optional().or(z.literal("")),
  notes: z.string().trim().max(500, "Not en fazla 500 karakter").optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;

export const warehouseFormDefaults: WarehouseFormValues = {
  name: "",
  address: "",
  notes: "",
  isActive: true,
};
