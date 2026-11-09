// Hedef özellik seçenekleri (kullanıcı 2026-11-09): rotadaki bir adımın istasyonu özelliği `mode === 'AUTO'` ile kendiliğinden
// veriyorsa sormak boşunadır → seçeneklerden düşer. Kural VERİDEN (istasyon yeteneği varsayılanları, sunucu
// `station-default-targets.helper`); fabrika/özellik adı sabitlenmez. Kalan seçenek yoksa alan hiç çizilmez.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouteDefaultTargets, type StationDefaultTargets } from '../../../../hooks/useRouteDefaultTargets';
import { fabricPropertyService } from '../../../../services/fabricProperty.service';
import type { ProductionRoute } from '../../../../services/route.service';

/** Saf: rotanın istasyonlarından herhangi biri AUTO ile veren BAYRAK özellikleri (sunucu AUTO satırlarını hep döner). */
export function autoAppliedPropertyIds(perStation: readonly StationDefaultTargets[]): string[] {
  const out = new Set<string>();
  for (const s of perStation) for (const t of s.targets) if (t.valueType === 'FLAG' && t.mode === 'AUTO') out.add(t.propertyId);
  return [...out];
}

/** Saf: katalogdan AUTO verilenler çıkar (OPTIONAL / REQUIRED bayrak kalır). */
export function targetPropOptions<T extends { id: string }>(catalog: readonly T[], autoIds: readonly string[]): T[] {
  const auto = new Set(autoIds);
  return catalog.filter((o) => !auto.has(o.id));
}

/** Hedef özellik verisi (katalog + rota varsayılanları); İE formu ve alan bloğu aynı sorguları paylaşır (önbellek). */
export function useTargetProps(route: ProductionRoute | null, customerId: string | null, enabled: boolean) {
  const catalog = useQuery({
    queryKey: ['fabric-properties', 'wo-picker'],
    queryFn: () => fabricPropertyService.getAll({ page: 1, pageSize: 200, sortBy: 'name', sortOrder: 'asc', filters: { isActive: 'true', valueType: 'FLAG' } }),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
  const defaults = useRouteDefaultTargets(route, [customerId], enabled);
  const list = defaults.byCustomer.get(customerId ?? '');
  const defaultIds = useMemo(() => [...new Set((list ?? []).flatMap((s) => s.targets.filter((t) => t.valueType === 'FLAG').map((t) => t.propertyId)))], [list]);
  const autoIds = useMemo(() => autoAppliedPropertyIds(list ?? []), [list]);
  const all = catalog.data?.data;
  const options = useMemo(() => targetPropOptions(all ?? [], autoIds), [all, autoIds]);
  const loaded = !catalog.isLoading && defaults.byCustomer.has(customerId ?? '');
  return {
    catalogLoading: catalog.isLoading,
    defaultsLoaded: defaults.byCustomer.has(customerId ?? ''),
    defaultIds,
    options,
    /** Yüklendi ve elemeden sonra seçilecek özellik yok → alan çizilmez. Yüklenirken bilinmez (alan durur). */
    empty: enabled && loaded && options.length === 0,
  };
}
