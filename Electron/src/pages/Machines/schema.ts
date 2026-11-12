import { z } from "zod";

/** Boş bırakılabilir sayı alanı: form metin taşır ("" = yok), virgül kabul; boş "0" sanılmasın diye coerce YOK. */
const optionalNumberText = (check: (n: number) => boolean, message: string, pattern = /^\d+([.,]\d{1,2})?$/) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (pattern.test(v) && check(Number(v.replace(",", ".")))), message);

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
  // Planlama (katlanır bölüm): hepsi isteğe bağlı.
  planRpm: optionalNumberText((n) => n > 0, "Devir sıfırdan büyük tam sayı olmalı", /^\d+$/),
  planEfficiencyPct: optionalNumberText((n) => n >= 0 && n <= 100, "Verim 0 ile 100 arasında olmalı"),
  maxWorkingWidthCm: optionalNumberText((n) => n > 0, "En sıfırdan büyük olmalı"),
  // Devere Faz 3: levent yuva sayısı 0..32 (0 = cağlıklı çözgü makinesi); devere kapalıyken alan çizilmez, 1 gider.
  warpBeamSlots: z.coerce.number().int("Yuva sayısı tam sayı olmalı").min(0, "Yuva sayısı negatif olamaz").max(32, "Yuva sayısı en fazla 32"),
});

export type MachineFormValues = z.infer<typeof machineFormSchema>;

export const machineFormDefaults: MachineFormValues = {
  stationId: "",
  name: "",
  warpBeamSlots: 1,
  planRpm: "",
  planEfficiencyPct: "",
  maxWorkingWidthCm: "",
};
