import { z } from "zod";
import { DefectSeverity } from "@/types/enums";
import { DEFECT_GROUPS } from "@/lib/hata-gruplari";

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
});

export type DefectTypeFormValues = z.infer<typeof defectTypeFormSchema>;

export const defectTypeFormDefaults: DefectTypeFormValues = {
  name: "",
  description: "",
  severity: "",
  defectGroup: "",
  isActive: true,
  isDefault: false,
};
