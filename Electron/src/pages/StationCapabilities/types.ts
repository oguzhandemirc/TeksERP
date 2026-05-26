import type { StationKind } from "@/types/enums";

/** GET /api/station-capabilities — özet liste (flat alanlar) */
export interface StationCapabilitySummary {
  stationId: string;
  stationCode: string;
  stationName: string;
  stationKind: StationKind;
  /** İstasyona varsayılan kategori atanmış mı? */
  hasDefaultCategory: boolean;
  /** İstasyon renk uygulayabilir mi? Kategori varsa appliesColor; yoksa true. */
  canApplyColor: boolean;
  /** İstasyon özellik uygulayabilir mi? Kategori varsa appliesProperty; yoksa true. */
  canApplyProperty: boolean;
  colorCount: number;
  propertyCount: number;
}

/** GET /api/station-capabilities/:stationId — detay */
export interface StationCapabilityDetail {
  stationId: string;
  stationCode: string;
  stationName: string;
  stationKind: StationKind;
  hasDefaultCategory: boolean;
  canApplyColor: boolean;
  canApplyProperty: boolean;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    color: string | null;
  }[];
}
