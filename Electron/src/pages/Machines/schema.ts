import { z } from "zod";

export const machineFormSchema = z.object({
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  name: z
    .string()
    .trim()
    .min(1, "Makine adı boş bırakılamaz")
    .max(120, "Makine adı en fazla 120 karakter olabilir"),
  deviceIp: z
    .string()
    .max(80, "Cihaz IP adresi en fazla 80 karakter olabilir")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
  deviceIp: "",
  isActive: true,
};
