import type { RollStatus } from "@/types/enums";

// Backend qgTargetEnum ile aynı küme (quality-grade.routes.ts) — STOCK dahil:
// ham (renksiz) kesimde "üretime devam" hedefi. Eksik üye boş Badge basıyordu.
export type QualityTargetStatus = Extract<
  RollStatus,
  "WAREHOUSE" | "A1_STOCK" | "STOCK" | "SCRAP"
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
