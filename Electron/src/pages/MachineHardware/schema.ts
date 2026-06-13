import { z } from "zod";

// Form alanları düz string ("" = boş); ""→null dönüşümü buildPayload'da (transform
// kullanmıyoruz — zod transform RHF defaultValues tipiyle çakışır).
export const machineHardwareFormSchema = z.object({
  machineId: z.string().min(1, "Makine seçilmeli"),
  printerIp: z.string().trim().max(64).optional().default(""),
  printerMac: z.string().trim().max(32).optional().default(""),
  kqMac: z.string().trim().max(32).optional().default(""),
  mtMac: z.string().trim().max(32).optional().default(""),
  mtMac2: z.string().trim().max(32).optional().default(""),
  kqPattern: z.string().trim().max(255).optional().default(""),
  mtPattern: z.string().trim().max(255).optional().default(""),
  mtPattern2: z.string().trim().max(255).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
  isActive: z.boolean(),
});

export type MachineHardwareFormValues = z.infer<typeof machineHardwareFormSchema>;

// Form → API payload: boş string ("") → null (donanım alanı "kayıtlı değil").
// Saf fonksiyon (sayfa + test paylaşır).
const nn = (v: string) => (v.trim() ? v.trim() : null);
export function buildMachineHardwarePayload(v: MachineHardwareFormValues) {
  return {
    machineId: v.machineId,
    printerIp: nn(v.printerIp),
    printerMac: nn(v.printerMac),
    kqMac: nn(v.kqMac),
    mtMac: nn(v.mtMac),
    mtMac2: nn(v.mtMac2),
    kqPattern: nn(v.kqPattern),
    mtPattern: nn(v.mtPattern),
    mtPattern2: nn(v.mtPattern2),
    notes: nn(v.notes),
    isActive: v.isActive,
  };
}

export const machineHardwareFormDefaults: MachineHardwareFormValues = {
  machineId: "",
  printerIp: "",
  printerMac: "",
  kqMac: "",
  mtMac: "",
  mtMac2: "",
  kqPattern: "",
  mtPattern: "",
  mtPattern2: "",
  notes: "",
  isActive: true,
};
