export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  /**
   * Özelliği uygulayabilen istasyonlar (`StationProperty`). Backend `defaultInclude`
   * ile listede de döner — "hiçbir istasyona bağlı değil" rozeti buna dayanır.
   * Boş dizi = özellik hiçbir iş emrinde SEÇİLEMEZ (kısıt, eksik veri değil).
   */
  stationCapabilities?: {
    stationId: string;
    station: { id: string; code: string; name: string; isActive: boolean };
  }[];
  createdAt: string;
  updatedAt: string;
}
