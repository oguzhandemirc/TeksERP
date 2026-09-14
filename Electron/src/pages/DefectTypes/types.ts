import type { DefectSeverity } from "@/types/enums";

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: DefectSeverity | null;
  isActive: boolean;
  /** Tipsiz hata girişi bu tipe düşer; kurulumda en fazla bir. */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
