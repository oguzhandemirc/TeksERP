import type { DefectSeverity } from "@/types/enums";
import type { DefectGroup } from "@/lib/hata-gruplari";

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: DefectSeverity | null;
  /** Rapor hata grubu (küme `@/lib/hata-gruplari`); null = gruplanmamış. */
  defectGroup: DefectGroup | null;
  isActive: boolean;
  /** Tipsiz hata girişi bu tipe düşer; kurulumda en fazla bir. */
  isDefault: boolean;
  /** K4P sabit puan (1–4); null = boyut sınıfından. Yalnız Kalite Güvence açıkken görünür/yazılır. */
  fixedPoints?: number | null;
  /** K4P tablet muayene düğme sırası (küçük önce). */
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}
