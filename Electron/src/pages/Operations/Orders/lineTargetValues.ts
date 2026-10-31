// =============================================================================
// SİPARİŞ SATIRI HEDEF DEĞERİ — panel tarafı (SY-F2, tasarım §7.5/§7.8)
// =============================================================================
// Değerler kodda DEĞİL: satırda seçili BAYRAĞIN çeşit özelliğinin (`variantOfPropertyId`) aktif değerleridir.
// Çeşidi olmayan bayrakta alan ÇİZİLMEZ; hiç hedef seçilmemiş satırın gövdesi bugünküyle bayt-aynıdır.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { FabricProperty } from "@/pages/FabricProperties/types";

export interface TargetValueItem {
  propertyId: string;
  valueId: string;
}

export interface VariantEntry {
  /** Çeşit (SEÇİM) özelliğinin kimliği — hedef yazımında `propertyId`. */
  propertyId: string;
  name: string;
  options: Array<{ id: string; name: string }>;
}

/** Bayrak kimliği → aktif çeşit özelliği (en az bir aktif değeri olan). */
export type VariantCatalog = ReadonlyMap<string, VariantEntry>;

export function buildVariantCatalog(rows: readonly FabricProperty[]): VariantCatalog {
  const map = new Map<string, VariantEntry>();
  for (const p of rows) {
    if (!p.isActive || p.valueType !== "CHOICE" || !p.variantOfPropertyId) continue;
    const options = (p.values ?? [])
      .filter((v) => v.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => ({ id: v.id, name: v.name }));
    if (options.length > 0) map.set(p.variantOfPropertyId, { propertyId: p.id, name: p.name, options });
  }
  return map;
}

const EMPTY: VariantCatalog = new Map();

/** Yalnız satırda seçili bayrak varken yüklenir — özelliksiz siparişte ek istek yok. */
export function useVariantCatalog(enabled: boolean): VariantCatalog {
  const q = useQuery({
    queryKey: ["fabric-properties", "order-line-variant-catalog"],
    queryFn: async () => {
      const res = await loadAllForPicker(fabricPropertyService, { sortBy: "sortOrder", filters: { isActive: "true" } });
      return buildVariantCatalog((res.data ?? []) as FabricProperty[]);
    },
    enabled,
    staleTime: 60_000,
  });
  return q.data ?? EMPTY;
}

/** Bayrak listesi değişince, bayrağı kaldırılan çeşidin hedefi de düşer (yoksa sunucu bayrağı geri ekler). */
export function pruneTargetValues(
  targets: readonly TargetValueItem[],
  flagIds: readonly string[],
  catalog: VariantCatalog,
): TargetValueItem[] {
  const allowed = new Set(flagIds.map((id) => catalog.get(id)?.propertyId).filter(Boolean));
  const known = new Set([...catalog.values()].map((v) => v.propertyId));
  // Katalogda tanınmayan hedef (henüz yüklenmedi) korunur; tanınan ama bayrağı gitmiş olan düşer.
  return targets.filter((t) => !known.has(t.propertyId) || allowed.has(t.propertyId));
}

/** Tek özelliğin hedefini yazar; `valueId` null = o özelliğin hedefini kaldır. */
export function setTargetValue(
  targets: readonly TargetValueItem[],
  propertyId: string,
  valueId: string | null,
): TargetValueItem[] {
  const rest = targets.filter((t) => t.propertyId !== propertyId);
  return valueId ? [...rest, { propertyId, valueId }] : rest;
}
