import { z } from "zod";

/** Sayı alanları formda METİN taşır (boş bırakılabilsin diye); gönderimde
 *  `buildPayload` sayıya çevirir. Sınırlar DB kolonlarıyla birebir. */
export const warpSpecFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Kod boş bırakılamaz")
    .max(32, "Kod en fazla 32 karakter olabilir"),
  name: z
    .string()
    .trim()
    .min(1, "Çözgü kartı adı boş bırakılamaz")
    .max(100, "Ad en fazla 100 karakter olabilir"),
  yarnItemId: z.string().min(1, "Çözgü ipliği seçilmeli"),
  // Tel adedi devere formülünün ilk çarpanı — sıfır sessizce 0 kg üretirdi.
  endsCount: z
    .string()
    .trim()
    .min(1, "Tel adedi zorunlu")
    .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, "Tel adedi sıfırdan büyük tam sayı olmalı"),
  selvedgeEnds: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0), "Kenar teli tam sayı olmalı")
    .optional()
    .or(z.literal("")),
  reedNo: z
    .string()
    .trim()
    .refine((v) => v === "" || Number(v) > 0, "Tarak no sayı olmalı")
    .optional()
    .or(z.literal("")),
  endsPerDent: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) > 0), "Dişe tel tam sayı olmalı")
    .optional()
    .or(z.literal("")),
  reedWidthCm: z
    .string()
    .trim()
    .refine((v) => v === "" || Number(v) > 0, "Tarak eni sayı olmalı")
    .optional()
    .or(z.literal("")),
  // Faz 4: take-up (%) — çözgü ÷ kumaş; boş = bilinmiyor (otomatik tüketim çözgü = kumaş sayar, uyarır).
  takeUpPct: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number(v) >= 0 && Number(v) < 100), "Take-up 0–100 arası yüzde olmalı (100 hariç)")
    .optional()
    .or(z.literal("")),
  notes: z.string().max(500, "Not en fazla 500 karakter olabilir").optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type WarpSpecFormValues = z.infer<typeof warpSpecFormSchema>;

export const warpSpecFormDefaults: WarpSpecFormValues = {
  code: "",
  name: "",
  yarnItemId: "",
  endsCount: "",
  selvedgeEnds: "",
  reedNo: "",
  endsPerDent: "",
  reedWidthCm: "",
  takeUpPct: "",
  notes: "",
  isActive: true,
};
