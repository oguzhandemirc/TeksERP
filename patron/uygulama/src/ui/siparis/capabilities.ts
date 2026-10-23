// Liste yetenekleri SUNUCUDAN (`GET /oturum` `liste`): eski sunucu alanı göndermez ve tanımadığı süzgeç parametresini
// yok sayar (süzülmemiş liste döner) — bu yüzden kimlik süzgeci ve yeni arama yalnız sunucu beyan ettiyse kullanılır.
import { LIST_SEARCH, type FacilityStatus, type ListIdFilterKey, type ListSearchSpec } from "../../api/wire";
import { useSession } from "../../state/session";

export interface ListCapability {
  /** Sunucu `projection` listesinde `key` kimlik süzgecini kabul ediyor mu. */
  idFilter(projection: string, key: ListIdFilterKey): boolean;
  /** Sunucu bu listede arama + süzgeç kabul ediyorsa beyan (uygulamanın tel aynasından); yoksa null. */
  search(projection: string): ListSearchSpec | null;
}

export function listCapability(facility: FacilityStatus | null): ListCapability {
  const liste = facility?.liste;
  return {
    idFilter: (projection, key) => !!liste?.kimlikSuzgecleri[key]?.includes(projection),
    search: (projection) =>
      liste?.aranabilir.includes(projection) && Object.prototype.hasOwnProperty.call(LIST_SEARCH, projection) ? (LIST_SEARCH[projection] ?? null) : null,
  };
}

export function useListCapability(): ListCapability {
  return listCapability(useSession().facility);
}
