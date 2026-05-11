/** GET /api/station-capabilities — özet liste (flat alanlar) */
export interface StationCapabilitySummary {
  stationId: string;
  stationCode: string;
  stationName: string;
  colorCount: number;
  propertyCount: number;
}

/** GET /api/station-capabilities/:stationId — detay */
export interface StationCapabilityDetail {
  stationId: string;
  stationCode: string;
  stationName: string;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    color: string | null;
  }[];
}
