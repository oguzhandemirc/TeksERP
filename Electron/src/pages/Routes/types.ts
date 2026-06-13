export interface RouteStep {
  id: string;
  routeId: string;
  stationId: string;
  sequence: number;
  defaultNotes: string | null;
  /** Saha #14: şablonda saklanan fason planlaması — WO açılışında default klonlanır. */
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
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
