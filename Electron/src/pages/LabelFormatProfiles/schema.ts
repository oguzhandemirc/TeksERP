import { z } from "zod";

// medya = fiziksel etiket; marginMm = GÜVENLİK PAYI (her kenardan içerik insetı).
export const labelFormatProfileFormSchema = z.object({
  code: z.string().trim().min(1, "Kod gerekli").max(48),
  name: z.string().trim().min(1, "Ad gerekli").max(100),
  widthMm: z.coerce.number().positive("Genişlik pozitif olmalı").max(2000),
  heightMm: z.coerce.number().positive("Yükseklik pozitif olmalı").max(2000),
  marginMm: z.coerce.number().min(0, "Pay negatif olamaz").max(50),
  gapMm: z.coerce.number().min(0).max(50),
  dpi: z.coerce.number().int().min(50).max(1200),
  orientation: z.enum(["PORTRAIT", "LANDSCAPE"]),
  isActive: z.boolean(),
});

export type LabelFormatProfileFormValues = z.infer<typeof labelFormatProfileFormSchema>;

export function buildLabelFormatProfilePayload(v: LabelFormatProfileFormValues) {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    widthMm: v.widthMm,
    heightMm: v.heightMm,
    marginMm: v.marginMm,
    gapMm: v.gapMm,
    dpi: v.dpi,
    orientation: v.orientation,
    isActive: v.isActive,
  };
}

export const labelFormatProfileFormDefaults: LabelFormatProfileFormValues = {
  code: "",
  name: "",
  // Kumaş etiketi standardı: 100×60 mm YATAY (topa yatay yapıştırılır, iki kolon).
  widthMm: 100,
  heightMm: 60,
  marginMm: 3,
  gapMm: 2,
  dpi: 203,
  orientation: "LANDSCAPE",
  isActive: true,
};
