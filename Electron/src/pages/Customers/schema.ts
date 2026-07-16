import { z } from "zod";
import { CompanyType } from "@/types/enums";

/**
 * Tek-adım müşteri oluşturmada satır-içi şube taslağı. Kompakt alanlar (Ad zorunlu +
 * Şehir/İletişim/Telefon) doğrudan; ayrıntılar (Kod/İlçe/Adres/Notlar) "Detaylar"
 * genişleticisinde. Sınırlar backend (customer-branch.routes createSchema) ile uyumlu.
 * Yalnız OLUŞTURMA formunda kullanılır; düzenlemede tam şube CRUD'ı ayrı sekmede.
 */
// name'de `min(1)` YOK: boş bırakılmış (hiç doldurulmamış) satır sessizce düşer —
// "Şube adı zorunlu" yalnız satırda içerik varken customerFormSchema.branches
// superRefine'ında zorlanır. Uzunluk sınırları DB kolonlarıyla birebir (name
// VARCHAR(100) / code VARCHAR(50)) — aşan girdi P2000 yerine net Türkçe 400 alsın.
export const branchDraftSchema = z.object({
  name: z.string().trim().max(100, "En fazla 100 karakter"),
  city: z.string().max(80, "En fazla 80 karakter").optional().or(z.literal("")),
  district: z.string().max(80, "En fazla 80 karakter").optional().or(z.literal("")),
  contactName: z.string().max(120, "En fazla 120 karakter").optional().or(z.literal("")),
  contactPhone: z.string().max(40, "En fazla 40 karakter").optional().or(z.literal("")),
  // Detaylar (opsiyonel genişletici)
  code: z.string().max(50, "En fazla 50 karakter").optional().or(z.literal("")),
  address: z.string().max(500, "En fazla 500 karakter").optional().or(z.literal("")),
  notes: z.string().max(500, "En fazla 500 karakter").optional().or(z.literal("")),
});

/** Bir taslak satırında herhangi bir alan dolu mu? (tümü boşsa satır gönderilmez). */
export function branchDraftHasContent(b: BranchDraftValues): boolean {
  return [
    b.name,
    b.city,
    b.district,
    b.contactName,
    b.contactPhone,
    b.code,
    b.address,
    b.notes,
  ].some((v) => (v ?? "").trim() !== "");
}

export type BranchDraftValues = z.infer<typeof branchDraftSchema>;

export const branchDraftDefaults: BranchDraftValues = {
  name: "",
  city: "",
  district: "",
  contactName: "",
  contactPhone: "",
  code: "",
  address: "",
  notes: "",
};

export const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Müşteri adı boş bırakılamaz")
    .max(200, "Müşteri adı en fazla 200 karakter olabilir"),
  taxNumber: z
    .string()
    .max(32, "Vergi numarası en fazla 32 karakter olabilir")
    .optional()
    .or(z.literal("")),
  type: z.enum([CompanyType.CUSTOMER, CompanyType.SUPPLIER], {
    message: "Müşteri veya tedarikçi seçilmeli",
  }),
  isActive: z.boolean(),
  // Yalnız oluşturma formunda dolar; düzenlemede boş kalır (şubeler sekmeden yönetilir).
  // superRefine: bir satırda İÇERİK varsa (herhangi bir alan dolu) ad zorunlu olur;
  // tamamen boş satır (yanlışlıkla "Şube ekle"ye basıp vazgeçme) hata vermez, düşer.
  branches: z
    .array(branchDraftSchema)
    .superRefine((rows, ctx) => {
      rows.forEach((row, i) => {
        if (branchDraftHasContent(row) && row.name.trim() === "") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, "name"],
            message: "Şube adı zorunlu",
          });
        }
      });
    })
    .default([]),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const customerFormDefaults: CustomerFormValues = {
  name: "",
  taxNumber: "",
  type: CompanyType.CUSTOMER,
  isActive: true,
  branches: [],
};
