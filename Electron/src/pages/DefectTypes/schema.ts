import { z } from "zod";
import { DefectSeverity } from "@/types/enums";
import { DEFECT_GROUPS } from "@/lib/hata-gruplari";
import type { DefectType } from "./types";

export const defectTypeFormSchema = z.object({
  // Sınır DB kolonuyla birebir (DefectType.name @db.VarChar(100)) — panel
  // master-data CRUD'un TEK doğrulama kapısıdır (`BaseController` Zod
  // koşturmaz); gevşek sınır net 400 yerine sessiz P2000 üretirdi.
  name: z
    .string()
    .trim()
    .min(1, "Hata adı boş bırakılamaz")
    .max(100, "Hata adı en fazla 100 karakter olabilir"),
  description: z
    .string()
    .max(500, "Açıklama en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
  severity: z
    .enum([DefectSeverity.MINOR, DefectSeverity.MAJOR, DefectSeverity.CRITICAL])
    .optional()
    .or(z.literal("")),
  // Küme tek kaynaktan (backend `constants/hata-gruplari.ts` aynası); "" = gruplanmamış.
  defectGroup: z.enum(DEFECT_GROUPS).or(z.literal("")),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  // K4P: "" = boyut sınıfından; 1–4 sabit puan (backend `normalizeDefectTypeFourPointBody` ile aynı küme).
  fixedPoints: z.enum(["", "1", "2", "3", "4"]),
});

export type DefectTypeFormValues = z.infer<typeof defectTypeFormSchema>;

export const defectTypeFormDefaults: DefectTypeFormValues = {
  name: "",
  description: "",
  severity: "",
  defectGroup: "",
  isActive: true,
  isDefault: false,
  fixedPoints: "",
};

/** Hata tipi yazma gövdesi — Hata Tipleri ekranı ve seçicideki kayıt formu (Yeni · Örnek al) aynısını kullanır. */
export const buildPayload = (
  v: DefectTypeFormValues,
  initial: DefectType | null,
  fourPoint = false,
): Partial<DefectType> => ({
  // Kod backend'de üretilir (HATA+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  description: v.description || null,
  severity: (v.severity || null) as DefectType["severity"],
  defectGroup: v.defectGroup || null,
  isActive: v.isActive,
  // `true` backend'de tek-varsayılan tx'inden geçer (eskisi düşer); `false` düz yazılır.
  isDefault: v.isDefault,
  // K4P: yalnız modül açıkken gider — kapalıyken gönderilen `null` mevcut sabit puanı silerdi.
  ...(fourPoint ? { fixedPoints: v.fixedPoints === "" ? null : Number(v.fixedPoints) } : {}),
});
