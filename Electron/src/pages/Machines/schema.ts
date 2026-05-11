import { z } from "zod";

export const machineFormSchema = z.object({
  stationId: z.string().min(1, "İstasyon gerekli"),
  name: z.string().min(1, "Ad gerekli").max(120),
  deviceIp: z.string().max(80).optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
  deviceIp: "",
  isActive: true,
};
