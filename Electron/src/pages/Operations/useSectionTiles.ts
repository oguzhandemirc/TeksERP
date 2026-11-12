import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isHubTileHidden } from "@/lib/menu-layout";
import { offEntryMode, useCanSeeOffModules } from "@/lib/off-module-visibility";
import { useOperationsVisibilityContext } from "./useOperationsVisibility";
import { operationGroups, type OperationGroupKey } from "./groups-config";
import { sectionTiles } from "./sections";
import type { OperationsTile } from "./tile-config";

export interface VisibleSectionTile extends OperationsTile {
  /** Bağlama göre çözülmüş ad (`titleWhen`). */
  label: string;
  /** Modül kapalı ama modülü açabilene soluk gösteriliyor — `offHint` ipucuyla. */
  off: boolean;
}

export interface SectionTilesState {
  /** Bayraklar yüklendi mi — yüklenmeden modüllü karo gizlenip sonra belirmesin diye çağıran iskelet çizer. */
  ready: boolean;
  tiles: Record<OperationGroupKey, VisibleSectionTile[]>;
  /** İzin açısından en az bir karosu var mı (bayrak yüklenmeden menü kökünü titretmemek için). */
  permitted: Record<OperationGroupKey, boolean>;
}

/**
 * Bölüm karolarının GÖRÜNÜRLÜĞÜ — tek süzgeç (menü alt listesi + bölüm sayfası + eski birleşik sayfa).
 * Kural sırası Operasyon hub'ının eski süzgeciyle aynı: menü düzeninde gizli değil · izin (admin kısa
 * devresi YOK) · kapalı modül yalnız açabilene soluk (`offEntryMode`).
 */
export function useSectionTiles(): SectionTilesState {
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const canSeeOff = useCanSeeOffModules();
  const menu = useMenuLayout();

  const permittedTile = (t: OperationsTile) =>
    t.permissionAny ? hasAnyPermission(t.permissionAny) : !t.permission || hasPermission(t.permission);
  const isOff = (t: OperationsTile) => Boolean(t.visibleWhen && !t.visibleWhen(ctx));

  const tiles = {} as Record<OperationGroupKey, VisibleSectionTile[]>;
  const permitted = {} as Record<OperationGroupKey, boolean>;
  for (const g of operationGroups) {
    const allowed = sectionTiles(g.key).filter((t) => !isHubTileHidden(menu, t.to) && permittedTile(t));
    permitted[g.key] = allowed.length > 0;
    tiles[g.key] = allowed
      .filter((t) => !isOff(t) || offEntryMode(true, Boolean(t.offHint), canSeeOff) !== "hide")
      .map((t) => ({ ...t, label: t.titleWhen?.(ctx) ?? t.title, off: isOff(t) }));
  }
  return { ready: ctx.flagsReady, tiles, permitted };
}
