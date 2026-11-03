// K22 — İE rota adımı ön seçimi: kural SUNUCUDA (`station-default-targets.helper`), tablet yalnız okur.
// Gelen belge İE formu ve S11 Belge masası bunu kullanır; müşteri başına bir sorgu (müşteri gramajı farklı).
import { useCallback, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiClient } from '../services/api';
import type { ProductionRoute } from '../services/route.service';
import { FOLD_PROPERTY_CODE } from '../services/fabricProperty.service';

export interface DefaultTarget {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  valueType: 'FLAG' | 'CHOICE';
  mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED';
  variantOfPropertyId: string | null;
  valueId: string | null;
  valueCode: string | null;
  valueName: string | null;
  source: 'CUSTOMER' | 'STATION' | 'VALUE_DEFAULT' | null;
}

export interface StationDefaultTargets {
  stationId: string;
  targets: DefaultTarget[];
}

/** Rotanın istasyonları sıra düzeninde (sunucu da aynı sırayla birleştirir: ilk adım kazanır). */
export function routeStationIds(route: ProductionRoute | null | undefined): string[] {
  const steps = [...(route?.steps ?? [])].sort((a, b) => a.sequence - b.sequence);
  return [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
}

export async function fetchDefaultTargets(stationIds: readonly string[], customerId: string | null): Promise<StationDefaultTargets[]> {
  const q = new URLSearchParams({ stationIds: stationIds.join(',') });
  if (customerId) q.set('customerId', customerId);
  const res = await apiClient.get<{ data?: StationDefaultTargets[] }>(`/station-capabilities/default-targets?${q.toString()}`);
  return res.data.data ?? [];
}

/** Sunucu cevabından bir özelliğin ön seçili değeri (rota sırasında ilk adım); yoksa null. */
export function defaultValueFor(perStation: readonly StationDefaultTargets[], propertyId: string | null): string | null {
  if (!propertyId) return null;
  for (const s of perStation) for (const t of s.targets) if (t.propertyId === propertyId) return t.valueId;
  return null;
}

/**
 * Formda alanı olmayan seçim varsayılanları (gramaj ve kat dışı; ilk adım kazanır) — gövdeye aynen gider.
 * Sunucu anahtarsız gövdeye değer dayatmaz; kat sunucuda `foldType`a çözülür.
 */
export function passThroughTargets(perStation: readonly StationDefaultTargets[] | null, gramajPropertyId: string | null): { propertyId: string; valueId: string }[] {
  const seen = new Set<string>();
  const out: { propertyId: string; valueId: string }[] = [];
  for (const s of perStation ?? []) {
    for (const t of s.targets) {
      if (seen.has(t.propertyId)) continue;
      seen.add(t.propertyId);
      if (t.valueType === 'CHOICE' && t.valueId && t.propertyId !== gramajPropertyId && t.propertyCode !== FOLD_PROPERTY_CODE) out.push({ propertyId: t.propertyId, valueId: t.valueId });
    }
  }
  return out;
}

/**
 * Müşteri başına ön seçim. `valueFor(customerId, propertyId)`: `undefined` = o müşterinin cevabı henüz yok
 * (çağıran bekler, uydurmaz); `null` = ön seçim yok. Uç okunamazsa (eski sunucu/izin) ön seçim yapılmaz — bugünkü gibi.
 */
export function useRouteDefaultTargets(route: ProductionRoute | null | undefined, customerIds: readonly (string | null)[], enabled = true) {
  const stationIds = useMemo(() => routeStationIds(route), [route]);
  // Değerle kararlı anahtar: çağıran her render'da yeni dizi verse de sorgular/harita yeniden doğmaz.
  const customerKey = [...new Set(customerIds.map((c) => c ?? ''))].sort().join('\u0000');
  const customers = useMemo(() => customerKey.split('\u0000'), [customerKey]);
  // Müşteri anahtarı → cevap: `null` = okunamadı/rota boş (ön seçim yok); anahtar yoksa henüz yükleniyor.
  const byCustomer = useQueries({
    queries: customers.map((c) => ({
      queryKey: ['station-default-targets', stationIds.join(','), c],
      queryFn: () => fetchDefaultTargets(stationIds, c || null),
      enabled: enabled && stationIds.length > 0,
      retry: false,
      staleTime: 60_000,
    })),
    combine: useCallback(
      (results: { data?: StationDefaultTargets[]; isError: boolean }[]) => {
        const m = new Map<string, StationDefaultTargets[] | null>();
        customers.forEach((c, i) => {
          const r = results[i];
          if (r?.data) m.set(c, r.data);
          else if (r?.isError || stationIds.length === 0) m.set(c, null);
        });
        return m;
      },
      [customers, stationIds.length],
    ),
  });
  const valueFor = useCallback(
    (customerId: string | null, propertyId: string | null): string | null | undefined => {
      const key = customerId ?? '';
      if (!byCustomer.has(key)) return undefined;
      const list = byCustomer.get(key);
      return list ? defaultValueFor(list, propertyId) : null;
    },
    [byCustomer],
  );
  /** `undefined` = cevap henüz yok; okunamadıysa boş liste. */
  const passThroughFor = useCallback(
    (customerId: string | null, gramajPropertyId: string | null) => {
      const key = customerId ?? '';
      if (!byCustomer.has(key)) return undefined;
      return passThroughTargets(byCustomer.get(key) ?? null, gramajPropertyId);
    },
    [byCustomer],
  );
  return { stationIds, byCustomer, valueFor, passThroughFor };
}
