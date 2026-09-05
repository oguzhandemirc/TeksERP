import { z } from "zod";

// Not: aktif/pasif durumu FORMDA yok — pasife alma/aktifleştirme ayrı satır/kart
// aksiyonlarıyla yapılır (kullanıcı ekranı deseni). Form yalnız kimlik alanları.
export const machineFormSchema = z.object({
  stationId: z.string().min(1, "İstasyon seçilmeli"),
  // Sınır DB kolonuyla birebir (Machine.name @db.VarChar(100)) — panel şeması
  // tek doğrulama kapısı; gevşek sınır sessiz P2000 üretirdi.
  name: z
    .string()
    .trim()
    .min(1, "Makine adı boş bırakılamaz")
    .max(100, "Makine adı en fazla 100 karakter olabilir"),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
};
