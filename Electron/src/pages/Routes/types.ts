export interface RouteStep {
  id: string;
  routeId: string;
  stationId: string;
  sequence: number;
  defaultNotes: string | null;
  /** Saha #14: şablonda saklanan fason planlaması — WO açılışında default klonlanır. */
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  /** "Fasona renksiz git" (2026-08-17 ekru kuralı) — şablonda saklanır, WO
   *  açılışında `WorkOrderStep.dispatchWithoutColor`a klonlanır. */
  dispatchWithoutColor?: boolean;
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
    /** İstasyonun KENDİ yeteneği (kategoriden AYRI — 2026-08-10). */
    appliesColor?: boolean;
    appliesProperty?: boolean;
    defaultCategoryId: string | null;
    /** ⚠️ `appliesColor/appliesProperty` uç TARAFINDAN dönülüyor (route.service
     *  select'i) ama tip bunları taşımıyordu → "rota renk uyguluyor mu" sorusunu
     *  masaüstünde sormanın yolu yoktu. Mobil `routeApplyCaps` bu iki bayrağı
     *  (istasyon VE kategori) birlikte okur; iki yüzey ayrışmasın. */
    defaultCategory?: {
      id: string;
      code: string;
      name: string;
      appliesColor?: boolean;
      appliesProperty?: boolean;
    } | null;
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
