// Belgeden İE satırlarında kurşun gramajı: katalog + sunucu ön seçimi + geç gelen cevapla yeniden tohumlama (useWoRows'tan ayrıldı).
import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fabricPropertyService, type KursunGramajCatalog } from '../../../../services/fabricProperty.service';
import { fetchDefaultTargets, passThroughTargets, useRouteDefaultTargets } from '../../../../hooks/useRouteDefaultTargets';
import type { ProductionRoute } from '../../../../services/route.service';
import { isDone, type DocRow } from './docRow';
import { isScanRoute, routeHasKursunStep } from './woFromDoc';

export type GramajFor = (customerId: string | null) => string | null | undefined;
type PassThrough = readonly { propertyId: string; valueId: string }[];
/** Cevap hazırsa eşzamanlı (kayıt akışı mikro-görev kaybetmez), değilse doğrudan okunur. */
type PassThroughFor = (customerId: string | null) => PassThrough | Promise<PassThrough>;

const EMPTY_CATALOG: KursunGramajCatalog = { propertyId: null, options: [] };

/** Gramaj alanı yalnız rotada kurşun adımı varsa; katalog okunamazsa boş (alan çizilmez, uydurma yok). */
export function useGramajCatalog(route: ProductionRoute, rows: DocRow[]): { showGramaj: boolean; catalog: KursunGramajCatalog; gramajFor: GramajFor; passThroughFor: PassThroughFor } {
  // Rotasız: hangi istasyona gideceği bilinmez → gramaj kutusu bugünkü gibi görünür (seçmek isteğe bağlı).
  const showGramaj = isScanRoute(route) || routeHasKursunStep(route);
  const q = useQuery({
    queryKey: ['fabric-properties', 'kursun-gramaj-catalog'],
    queryFn: fabricPropertyService.getKursunGramajCatalog,
    enabled: showGramaj,
    retry: false,
    staleTime: 60_000,
  });
  const catalog = showGramaj ? q.data ?? EMPTY_CATALOG : EMPTY_CATALOG;
  // K22: ön seçim sunucu çözücüsünden (müşteri > istasyon yeteneği > değer varsayılanı); tablet kural yazmaz.
  // Kurşunsuz rotada da okunur: formda alanı olmayan seçim değerleri gövdeye aynen gider.
  const defaults = useRouteDefaultTargets(route, rows.map((r) => r.form?.ownerCustomerId ?? r.detail?.ownerCustomerId ?? null));
  const { valueFor } = defaults;
  const propertyId = catalog.propertyId;
  const gramajFor = useCallback<GramajFor>(
    (customerId) => {
      if (!showGramaj || !propertyId) return null;
      const id = valueFor(customerId, propertyId);
      // Katalogda olmayan (pasif) değer önerilmez.
      return id && !catalog.options.some((o) => o.id === id) ? null : id;
    },
    [showGramaj, propertyId, valueFor, catalog],
  );
  const gramajPropertyId = showGramaj ? propertyId : null;
  // Kayıt anında cevap henüz yoksa doğrudan okunur (kayıt beklemez); okunamazsa iletilecek değer yok.
  const passThroughFor = useCallback<PassThroughFor>(
    (customerId) =>
      defaults.passThroughFor(customerId, gramajPropertyId) ??
      (defaults.stationIds.length === 0 ? [] : fetchDefaultTargets(defaults.stationIds, customerId).then((l) => passThroughTargets(l, gramajPropertyId), () => [])),
    [defaults, gramajPropertyId],
  );
  return { showGramaj, catalog, gramajFor, passThroughFor };
}

/** Çözücü cevabı satırdan sonra gelirse (ya da müşteri değişince) dokunulmamış satırlara ön seçim düşer. */
export function useGramajReseed(setRows: Dispatch<SetStateAction<DocRow[]>>, gramajFor: GramajFor): void {
  useEffect(() => {
    setRows((rs) => {
      let changed = false;
      const next = rs.map((r) => {
        if (!r.form || r.gramajTouched || isDone(r)) return r;
        const id = gramajFor(r.form.ownerCustomerId);
        if (id === undefined || id === r.form.gramajValueId) return r;
        changed = true;
        return { ...r, form: { ...r.form, gramajValueId: id } };
      });
      return changed ? next : rs;
    });
  }, [setRows, gramajFor]);
}
