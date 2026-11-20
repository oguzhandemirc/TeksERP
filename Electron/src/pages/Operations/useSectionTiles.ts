import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isHubTileHidden } from "@/lib/menu-layout";
import { offEntryMode, useCanSeeOffModules } from "@/lib/off-module-visibility";
import { useOperationsVisibilityContext } from "./useOperationsVisibility";
import { operationGroups, type OperationGroupKey } from "./groups-config";
import { sectionTiles } from "./sections";
import type { OperationsTile } from "./tile-config";
import { isPathLicenseClosed } from "@/lib/license/module-enabled";
import { layoutSubgroups, type NavSubgroup } from "@/components/layout/nav-subgroups";

export interface VisibleSectionTile extends OperationsTile {
  /** Bağlama göre çözülmüş ad (`titleWhen`). */
  label: string;
  /** Modül kapalı ama modülü açabilene soluk gösteriliyor — `offHint` ipucuyla. */
  off: boolean;
}

export interface SectionTilesState {
  /** Bayraklar yüklendi mi — yüklenmeden modüllü karo gizlenip sonra belirmesin diye çağıran iskelet çizer. */
  ready: boolean;
  /** Bölümün görünür karoları, süreç sırasıyla (alt grupların düz hali; çapraz listelenenler dahil). */
  tiles: Record<OperationGroupKey, VisibleSectionTile[]>;
  /** Süreç alt grupları — yan menü ve bölüm sayfası aynı başlıkları çizer. */
  groups: Record<OperationGroupKey, NavSubgroup<VisibleSectionTile>[]>;
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

  const home = {} as Record<OperationGroupKey, VisibleSectionTile[]>;
  const permitted = {} as Record<OperationGroupKey, boolean>;
  for (const g of operationGroups) {
    const allowed = sectionTiles(g.key).filter((t) => !isHubTileHidden(menu, t.to) && permittedTile(t));
    permitted[g.key] = allowed.length > 0;
    home[g.key] = allowed
      .filter((t) => !isOff(t) || offEntryMode(true, Boolean(t.offHint), canSeeOff && !isPathLicenseClosed(t.to, ctx.licenseClosedModules)) !== "hide")
      .map((t) => ({ ...t, label: t.titleWhen?.(ctx) ?? t.title, off: isOff(t) }));
  }
  // Süreç alt grupları (`nav-subgroups.ts`): havuz bütün bölümlerin GÖRÜNÜR karoları — çapraz listelenen karo
  // kendi süzgecinden geçmiş haliyle gelir, kapı ikinci kez yazılmaz.
  const pool = operationGroups.flatMap((g) => home[g.key]);
  const tiles = {} as Record<OperationGroupKey, VisibleSectionTile[]>;
  const groups = {} as Record<OperationGroupKey, NavSubgroup<VisibleSectionTile>[]>;
  for (const g of operationGroups) {
    groups[g.key] = layoutSubgroups(g.route, home[g.key], ctx, pool);
    tiles[g.key] = groups[g.key].flatMap((s) => s.items);
  }
  return { ready: ctx.flagsReady, tiles, groups, permitted };
}
