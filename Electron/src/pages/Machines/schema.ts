import { z } from "zod";

// Not: aktif/pasif durumu FORMDA yok — pasife alma/aktifleştirme ayrı satır/kart
// aksiyonlarıyla yapılır (kullanıcı ekranı deseni). Form yalnız kimlik alanları.
export const machineFormSchema = z.object({
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  name: z
    .string()
    .trim()
    .min(1, "Makine adı boş bırakılamaz")
    .max(120, "Makine adı en fazla 120 karakter olabilir"),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
};
