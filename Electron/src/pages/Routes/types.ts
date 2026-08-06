export interface RouteStep {
  id: string;
  routeId: string;
  stationId: string;
  sequence: number;
  defaultNotes: string | null;
  /** Saha #14: şablonda saklanan fason planlaması — WO açılışında default klonlanır. */
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  /** 2026-08-06: adımın şablon hedefi — WO açılışında hedef alanlara kopyalanır. */
  plannedColorId?: string | null;
  plannedColor?: { id: string; code: string; name: string; hex: string | null } | null;
  plannedProperties?: {
    propertyId: string;
    property?: { id: string; code: string; name: string };
  }[];
  station?: {
    id: string;
    code: string;
    name: string;
    type: "INTERNAL" | "EXTERNAL";
    kind: string;
    defaultCategoryId: string | null;
    defaultCategory?: { id: string; code: string; name: string } | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProductionRoute {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  isFavorite: boolean;
  customerId: string | null;
  isActive: boolean;
  steps: RouteStep[];
  customer?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}
