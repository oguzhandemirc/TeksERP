import { cn } from "@/lib/utils";
import { flagOffHint } from "@/lib/flag-setting-path";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { offEntryMode, useCanSeeOffModules } from "@/lib/off-module-visibility";
import { useFavorites } from "@/hooks/useFavorites";
import { useMenuOrder } from "@/hooks/useMenuOrder";
import { ADMIN_PERMISSION_LIST } from "@/types/auth";
import { ADVANCED_GROUP_LABEL, navGroups, type NavItem, type NavGroup } from "./nav-config";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { findCommandEntry, type CommandEntry } from "./command-entries";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarBrand, SidebarFooter } from "./sidebar-brand";
import { SidebarPathsCtx } from "./sidebar-items";
import { CollapsedNav, ExpandedNav } from "./sidebar-nav";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isMenuHidden } from "@/lib/menu-layout";
import { useAuthStore } from "@/store/auth";
import { isSuperadminGateOpen } from "@/lib/superadmin-gate";
import { useLicenseScreenVisible } from "@/hooks/useLicenseStatus";

interface Props {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: Props) {
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();
  // ⚠️ BAYRAKLAR BAĞLAMDAN OKUNUR, sorgudan DEĞİL (2026-09-03). Eski satır
  // `flagsQuery.data?.data?.[item.featureFlag] ?? false` idi: TEK bir jenerik
  // varsayılan. `featureFlag` union'ı beş modüle genişlerken bu, sessiz bir
  // hata kaynağına dönüşürdü — `production.enabled`ın backend varsayılanı AÇIK
  // olduğu için `?? false` fabrikada satırı bayrak yüklenene kadar GİZLER ve
  // gözle görülür bir titreme doğurur. Bağlam ayrıca `iplikEnabled`ı ETKİN
  // değeriyle (`ticaret && iplik`) verir; zincir tek yerde çözülür.
  const visibilityCtx = useOperationsVisibilityContext();
  const canSeeOff = useCanSeeOffModules();
  const { favorites, reorderFavorites } = useFavorites();
  const { orderItems, setGroupOrder } = useMenuOrder();

  // Favoriler grubu → backend favori sırası; diğer gruplar → localStorage menü sırası.
  const handleReorder = (groupLabel: string, order: string[]) => {
    if (groupLabel === "Favoriler") reorderFavorites(order);
    else setGroupOrder(groupLabel, order);
  };

  const visible = (item: NavItem) => {
    if (item.adminOnly && !isAdmin && !hasAnyPermission(ADMIN_PERMISSION_LIST)) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.permissionAny && !hasAnyPermission(item.permissionAny)) return false;
    // Belirsizken düşülecek taraf BAYRAĞA GÖRE değişir ve kararı bağlam verir:
    // "Muhasebe" belirsizken çizilmez (fabrikada bir an belirip kaybolmasın),
    // üretim belirsizken çizilir (fabrikada bir an kaybolup gelmesin).
    // Sonuçlanmış kapalı satır yalnız modülü açabilene soluk çizilir (`withOffHint`), diğerine hiç (2026-11-01).
    if (item.featureFlag && !visibilityCtx[item.featureFlag]) {
      if (!visibilityCtx.flagsReady || offEntryMode(true, true, canSeeOff) === "hide") return false;
    }
    return true;
  };
  const withOffHint = (item: NavItem): NavItem =>
    item.featureFlag && !visibilityCtx[item.featureFlag] ? { ...item, offHint: flagOffHint(item.featureFlag) } : item;

  // Favoriler — katalogdan çözülen sabitlenmiş sayfalar, en üstte ayrı grup
  // (kendi sırasını korur, menü sürüklemeye dahil değil).
  const favItems: NavItem[] = favorites
    .map(findCommandEntry)
    .filter((e): e is CommandEntry => Boolean(e))
    .map((e) => ({
      label: e.label,
      to: e.to,
      icon: e.icon,
      permission: e.permission,
      permissionAny: e.permissionAny,
      adminOnly: e.adminOnly,
    }))
    .filter(visible);
  const favGroup: NavGroup[] = favItems.length > 0 ? [{ label: "Favoriler", items: favItems }] : [];

  // K19 menü düzeni: gizlenen kök satır kalkar; ayar yokken süzgeç boştur (bugünkü menü bayt bayt aynı).
  const menu = useMenuLayout();
  const isSystemAccount = useAuthStore((s) => s.isSystemAccount);
  const systemAccountExists = useAuthStore((s) => s.systemAccountExists);
  const superadminGateOpen = isSuperadminGateOpen({ isSystemAccount, systemAccountExists });
  const licenseScreenVisible = useLicenseScreenVisible();

  // Nav grupları — kullanıcı sürükle-bırak sırası uygulanır (localStorage).
  const navOrdered: NavGroup[] = navGroups
    .map((g) => ({ ...g, items: orderItems(g.label, g.items.filter((i) => !isMenuHidden(menu, i.to)).filter(visible).map(withOffHint)) }))
    .filter((g) => g.items.length > 0);

  // "Gelişmiş" grubu — teknik ekranlar hub'lardan çıkıp burada toplanır (yalnız ayar açıkken; hub/palet ile AYNI kapılar).
  const advancedItems: NavItem[] = [...menu.advanced]
    .map((key) => findCommandEntry(`/${key}`))
    .filter((e): e is CommandEntry => Boolean(e))
    .filter((e) => !isMenuHidden(menu, e.to))
    .filter((e) => (!e.superadminOnly || superadminGateOpen) && (!e.licenseObservationGate || licenseScreenVisible))
    .map((e) => ({ label: e.label, to: e.to, icon: e.icon, permission: e.permission, permissionAny: e.permissionAny, adminOnly: e.adminOnly }))
    .filter(visible);
  const advancedGroup: NavGroup[] =
    advancedItems.length > 0 ? [{ label: ADVANCED_GROUP_LABEL, items: orderItems(ADVANCED_GROUP_LABEL, advancedItems), collapsible: true }] : [];

  const groups = [...favGroup, ...navOrdered, ...advancedGroup];
  const allPaths = groups.flatMap((g) => g.items.map((i) => i.to));

  return (
    <aside
      data-sidebar-root
      className={cn(
        "flex h-full select-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-[76px]" : "w-60",
      )}
    >
      <SidebarBrand collapsed={collapsed} />

      <SidebarPathsCtx.Provider value={allPaths}>
        <TooltipProvider delayDuration={150}>
          {collapsed ? (
            <CollapsedNav groups={groups} />
          ) : (
            <ExpandedNav groups={groups} onReorder={handleReorder} />
          )}
        </TooltipProvider>
      </SidebarPathsCtx.Provider>

      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
