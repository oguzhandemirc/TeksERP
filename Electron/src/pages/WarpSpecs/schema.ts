import { z } from "zod";
import { acceptNumberAsText } from "@/lib/decimal-form-text";

/** Sayı alanları formda METİN taşır (boş bırakılabilsin diye); gönderimde
 *  `buildPayload` sayıya çevirir. API Decimal'i sayı döndürür → `acceptNumberAsText` ikisini de kabul eder. Sınırlar DB kolonlarıyla birebir. */
/** Sunucudaki `WARP_SPEC_MAX_YARNS` aynası. */
export const WARP_SPEC_MAX_YARNS = 20;

/** Tek iplik satırı; tel adedi devere formülünün ilk çarpanı — sıfır sessizce 0 kg üretirdi. */
export const warpYarnRowSchema = z.object({
  yarnItemId: z.string().min(1, "Çözgü ipliği seçilmeli"),
  endsCount: acceptNumberAsText(
    z
      .string()
      .trim()
      .min(1, "Tel sayısı zorunlu")
      .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, "Tel sayısı sıfırdan büyük tam sayı olmalı"),
  ),
});

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
  // Fason devere D3: iplik satırları (sunucu sınırlarıyla aynı: 1..20, aynı iplik iki kez yok).
  yarns: z
    .array(warpYarnRowSchema)
    .min(1, "En az bir çözgü ipliği girilmeli")
    .max(WARP_SPEC_MAX_YARNS, `En fazla ${WARP_SPEC_MAX_YARNS} iplik satırı olabilir`)
    .refine(
      (rows) => new Set(rows.map((r) => r.yarnItemId).filter(Boolean)).size === rows.filter((r) => r.yarnItemId).length,
      "Aynı iplik iki satırda olamaz — telini tek satırda topla",
    ),
  sequenceNote: z.string().max(160, "Çözgü dizimi en fazla 160 karakter olabilir").optional().or(z.literal("")),
  selvedgeEnds: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) >= 0), "Kenar teli tam sayı olmalı")
      .optional()
      .or(z.literal("")),
  ),
  reedNo: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || Number(v) > 0, "Tarak no sayı olmalı")
      .optional()
      .or(z.literal("")),
  ),
  endsPerDent: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || (Number.isInteger(Number(v)) && Number(v) > 0), "Dişten geçen tel tam sayı olmalı")
      .optional()
      .or(z.literal("")),
  ),
  reedWidthCm: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || Number(v) > 0, "Tarak eni sayı olmalı")
      .optional()
      .or(z.literal("")),
  ),
  // Faz 4: take-up (%) — çözgü ÷ kumaş; boş = bilinmiyor (otomatik tüketim çözgü = kumaş sayar, uyarır).
  takeUpPct: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || (Number(v) >= 0 && Number(v) < 100), "Take-up 0–100 arası yüzde olmalı (100 hariç)")
      .optional()
      .or(z.literal("")),
  ),
  // SY-C1 kart firesi (%) — maliyet zincirinde YAPI'dan sonra, PARAMETRE'den önce; boş = parametre varsayılanı.
  wastePct: acceptNumberAsText(
    z
      .string()
      .trim()
      .refine((v) => v === "" || (Number(v) >= 0 && Number(v) < 100), "Fire 0–100 arası yüzde olmalı (100 hariç)")
      .optional()
      .or(z.literal("")),
  ),
  notes: z.string().max(500, "Not en fazla 500 karakter olabilir").optional().or(z.literal("")),
  isActive: z.boolean(),
});

export type WarpSpecFormValues = z.infer<typeof warpSpecFormSchema>;

export const warpSpecFormDefaults: WarpSpecFormValues = {
  code: "",
  name: "",
  yarns: [{ yarnItemId: "", endsCount: "" }],
  sequenceNote: "",
  selvedgeEnds: "",
  reedNo: "",
  endsPerDent: "",
  reedWidthCm: "",
  takeUpPct: "",
  wastePct: "",
  notes: "",
  isActive: true,
};
