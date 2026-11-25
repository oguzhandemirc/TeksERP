import { z } from "zod";
import type { Warehouse } from "./types";

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

/** Depo yazma gövdesi — Depolar ekranı ve seçicideki kayıt formu (Yeni · Örnek al) aynısını kullanır. */
export const buildWarehousePayload = (v: WarehouseFormValues, initial: Warehouse | null): Partial<Warehouse> => ({
  // Kod backend'de üretilir (DP+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  address: v.address || null,
  notes: v.notes || null,
  isActive: v.isActive,
});
