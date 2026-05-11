import type { StationKind, StationType } from "@/types/enums";

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind: StationKind;
  department: string | null;
  isActive: boolean;
  defaultCategoryId: string | null;
  defaultCategory?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
