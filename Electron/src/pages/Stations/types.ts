import type { StationKind, StationType } from "@/types/enums";

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind: StationKind;
  department: string | null;
  isActive: boolean;
  /** Bu istasyon RENK uygulayabilir mi? (2026-08-10 — yetenek kategoriden ayrıldı) */
  appliesColor: boolean;
  /** Bu istasyon ÖZELLİK uygulayabilir mi? */
  appliesProperty: boolean;
  defaultCategoryId: string | null;
  defaultCategory?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
