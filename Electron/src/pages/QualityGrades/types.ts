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
  /** Bu kalitedeki top OTOMATİK etiket ALMAZ (sahada FİRE). Katalogdan gelir;
   *  `scrapGradeLabelEnabled` ayarı AÇIKSA yok sayılır (iki kapı).
   *  Eski sunucuda alan YOK → optional; okurken `=== true` ile daralt. */
  skipLabel?: boolean;
  createdAt: string;
  updatedAt: string;
}
