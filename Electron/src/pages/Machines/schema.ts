import { z } from "zod";

export const machineFormSchema = z.object({
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  name: z
    .string()
    .trim()
    .min(1, "Makine adı boş bırakılamaz")
    .max(120, "Makine adı en fazla 120 karakter olabilir"),
  isActive: z.boolean(),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
  isActive: true,
};
