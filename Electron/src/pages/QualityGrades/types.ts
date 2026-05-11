import type { RollStatus } from "@/types/enums";

export type QualityTargetStatus = Extract<
  RollStatus,
  "WAREHOUSE" | "A1_STOCK" | "SCRAP"
>;

export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  targetStatus: QualityTargetStatus;
  createdAt: string;
  updatedAt: string;
}
