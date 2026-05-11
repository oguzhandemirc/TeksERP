import type { DefectSeverity } from "@/types/enums";

export interface DefectType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  severity: DefectSeverity | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
