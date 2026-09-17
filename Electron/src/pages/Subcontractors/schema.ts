import { z } from "zod";

export const NO_LINK_MESSAGE = "Fason profili bir cari kartına bağlı olmalı — Bağlı cari seçin ya da oluşturun.";

export const subcontractorFormSchema = z.object({
  // Sınır DB kolonuyla birebir (Subcontractor.name @db.VarChar(100)) — panel
  // şeması tek doğrulama kapısı; gevşek sınır sessiz P2000 üretirdi.
  name: z
    .string()
    .trim()
    .min(1, "Fason firma adı boş bırakılamaz")
    .max(100, "Fason firma adı en fazla 100 karakter olabilir"),
  taxNumber: z
    .string()
    .max(32, "Vergi numarası en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .max(32, "Telefon en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
  address: z
    .string()
    .max(500, "Adres en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  isActive: z.boolean(),
  isFavorite: z.boolean(),
  // Belge şablon profili — boş = genel Belge Şablonları ayarı.
  documentProfileId: z.string().uuid().nullable().optional(),
  categoryIds: z
    .array(z.string())
    .min(1, "En az bir fason kategorisi seçilmeli"),
  // Rol modeli (kullanıcı 15:50): fason PROFİLİ bir cari kartına BAĞLI doğar/kalır — bağsız kaydedilemez
  // (bağsız fason üretmek modele ters; "Cari kart oluştur ve bağla" yolu kalır). Tip/tekillik kuralı sunucuda.
  customerId: z.string({ message: NO_LINK_MESSAGE }).uuid({ message: NO_LINK_MESSAGE }),
});

export type SubcontractorFormValues = z.infer<typeof subcontractorFormSchema>;

export const subcontractorFormDefaults: SubcontractorFormValues = {
  name: "",
  taxNumber: "",
  phone: "",
  address: "",
  isActive: true,
  isFavorite: false,
  documentProfileId: null,
  categoryIds: [],
  // Form değeri boş başlar; şema `uuid` ister — Kaydet bağsız geçmez.
  customerId: null as unknown as string,
};
