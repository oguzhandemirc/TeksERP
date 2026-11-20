// Liste yetenekleri SUNUCUDAN (`GET /oturum` `liste`): eski sunucu alanı göndermez ve tanımadığı süzgeç parametresini
// yok sayar (süzülmemiş liste döner) — bu yüzden kimlik süzgeci ve yeni arama yalnız sunucu beyan ettiyse kullanılır.
import { LIST_SEARCH, type FacilityStatus, type ListIdFilterKey, type ListKeyFilterKey, type ListMemberFilterKey, type ListSearchSpec } from "../../api/wire";
import { useSession } from "../../state/session";

export interface ListCapability {
  /** Sunucu `projection` listesinde `key` kimlik süzgecini kabul ediyor mu. */
  idFilter(projection: string, key: ListIdFilterKey): boolean;
  /** Sunucu bu listede arama + süzgeç kabul ediyorsa beyan (uygulamanın tel aynasından); yoksa null. */
  search(projection: string): ListSearchSpec | null;
  /** Sunucu `projection` listesinde fabrika anahtarı süzgecini (`kategoriAnahtari`) kabul ediyor mu; eski sunucu: hayır. */
  keyFilter(projection: string, key: ListKeyFilterKey): boolean;
  /** Sunucu `projection` listesinde üyelik süzgecini (İE aşama/firma/müşteri/sipariş) kabul ediyor mu; eski sunucu: hayır. */
  memberFilter(projection: string, key: ListMemberFilterKey): boolean;
  /** Sunucunun bu listede sıralayabildiği alanlar (`liste.siralama`); eski sunucu: boş (sıralama seçimi gizli). */
  sortFields(projection: string): readonly string[];
  /** Sunucu görünüm tercihi ucunu taşıyor mu (bulut + `liste.siralama` beyanı); değilse tercih cihazda. */
  prefsOnServer: boolean;
}

export function listCapability(facility: FacilityStatus | null): ListCapability {
  const liste = facility?.liste;
  return {
    idFilter: (projection, key) => !!liste?.kimlikSuzgecleri[key]?.includes(projection),
    search: (projection) =>
      liste?.aranabilir.includes(projection) && Object.prototype.hasOwnProperty.call(LIST_SEARCH, projection) ? (LIST_SEARCH[projection] ?? null) : null,
    keyFilter: (projection, key) => !!liste?.anahtarSuzgecleri?.[key]?.includes(projection),
    memberFilter: (projection, key) => !!liste?.uyelikSuzgecleri?.[projection]?.includes(key),
    sortFields: (projection) => liste?.siralama?.[projection] ?? [],
    // Tercih ucu ve `simdiEsitle` beyanı aynı bulut sürümünde geldi; ERP oturumu bu alanı göndermez (tercih cihazda).
    prefsOnServer: facility?.simdiEsitle === true,
  };
}

export function useListCapability(): ListCapability {
  return listCapability(useSession().facility);
}
