// =============================================================================
// İş Emirleri — "İş Emri Türü" grupları + okutma düğmesi adları (SAF; testli)
// =============================================================================
// Tür: iki grup — "Özel iş emirleri" (Okutmayla fabrikada rotasız + kısayol işaretli rotalar) ve "Hazır rotalar" (kalan
// aktif rotalar). Varsayılan: Okutmayla → rotasız; Sıralı → ilk hazır rota (yoksa ilk kısayol; hiçbiri yoksa null →
// Okut pasif). Rotasız SIRALI'da sunulmaz: sunucu 400 `GELEN_BELGE_ROUTE_REQUIRED` verir (kural değişmez).
// =============================================================================
import type { ProductionRoute } from '../../../services/route.service';
import { SCAN_ROUTE, shortcutRoutes } from '../GelenBelge/woCreate/woFromDoc';
import type { WoCreateKind } from '../../../store/woCreateKinds';

export interface TypeGroups {
  special: ProductionRoute[];
  ready: ProductionRoute[];
}

export function typeGroups(allRoutes: readonly ProductionRoute[], shortcuts: readonly ProductionRoute[], scanMode: boolean): TypeGroups {
  const special = shortcutRoutes(shortcuts);
  const ids = new Set(special.map((r) => r.id));
  const ready = allRoutes
    .filter((r) => r.isActive !== false && !ids.has(r.id) && r.isWorkOrderShortcut !== true)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return { special: scanMode ? [SCAN_ROUTE, ...special] : special, ready };
}

export function defaultType(g: TypeGroups, scanMode: boolean): ProductionRoute | null {
  if (scanMode) return g.special[0] ?? null;
  return g.ready[0] ?? g.special[0] ?? null;
}

/** Seçili tür hâlâ listede mi (rota pasife alındı / kip değişti) — değilse varsayılana dönülür. */
export function resolveType(selectedId: string | null, g: TypeGroups, scanMode: boolean): ProductionRoute | null {
  const all = [...g.special, ...g.ready];
  return (selectedId ? all.find((r) => r.id === selectedId) : undefined) ?? defaultType(g, scanMode);
}

/** Alt çubuk düğme adları (tür başına ayrı düğme; her biri doğrudan okutmaya gider). */
export const KIND_BUTTON: Record<WoCreateKind, string> = { STANDARD: 'Belge Okut', CUSTOMER_GOODS: 'Fason Belge Okut' };

/** Okutma akışının İE türü: Fason düğmesi → Fason (müşteri malı); İE oluştur → null (bugünkü türetme). */
export const scanWoType = (kind: WoCreateKind): 'CUSTOMER_GOODS_SERVICE' | null => (kind === 'CUSTOMER_GOODS' ? 'CUSTOMER_GOODS_SERVICE' : null);
