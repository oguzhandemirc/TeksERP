import { motion } from "framer-motion";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { flagOffHint } from "@/lib/flag-setting-path";
import { staggerContainer } from "@/lib/motion";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { offEntryMode, useCanSeeOffModules } from "@/lib/off-module-visibility";
import { useFavorites } from "@/hooks/useFavorites";
import { useMenuOrder } from "@/hooks/useMenuOrder";
import { ADMIN_PERMISSION_LIST } from "@/types/auth";
import { ADVANCED_GROUP_LABEL, navGroups, type NavItem, type NavGroup } from "./nav-config";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { findCommandEntry, type CommandEntry } from "./command-entries";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarBrand, SidebarFooter } from "./sidebar-brand";
import { SidebarPathsCtx, CollapsedItem, SortableExpandedItem } from "./sidebar-items";
import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
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
      className={cn(
        "flex h-full select-none flex-col border-r border-border/60 bg-gradient-to-b from-card/60 via-card/50 to-card/40 backdrop-blur-xl transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-56",
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

function CollapsedNav({ groups }: { groups: NavGroup[] }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <nav className="flex flex-1 flex-col items-center overflow-y-auto py-4">
      {groups.map((group, idx) => (
        <div key={group.label} className="flex w-full flex-col items-center">
          {idx > 0 && <div className="my-2 h-px w-8 bg-border/50" />}
          {group.collapsible && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-expanded={advancedOpen}
                  aria-label={group.label}
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
                >
                  <Wrench className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{group.label}</TooltipContent>
            </Tooltip>
          )}
          {(!group.collapsible || advancedOpen) && <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="flex w-full flex-col items-center gap-1.5"
          >
            {group.items.map((item) => (
              <CollapsedItem key={item.to} item={item} />
            ))}
          </motion.ul>}
        </div>
      ))}
    </nav>
  );
}

function ExpandedNav({
  groups,
  onReorder,
}: {
  groups: NavGroup[];
  onReorder: (groupLabel: string, order: string[]) => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto py-3">
      {groups.map((group) => (
        <ExpandedGroup key={group.label} group={group} onReorder={onReorder} />
      ))}
    </nav>
  );
}

function ExpandedGroup({
  group,
  onReorder,
}: {
  group: NavGroup;
  onReorder: (groupLabel: string, order: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = group.items.map((i) => i.to);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = ids.indexOf(active.id as string);
    const newI = ids.indexOf(over.id as string);
    if (oldI < 0 || newI < 0) return;
    onReorder(group.label, arrayMove(ids, oldI, newI));
  };

  // K19 Gelişmiş grubu: başlık düğmedir, grup varsayılan KAPALI açılır.
  const [open, setOpen] = useState(!group.collapsible);
  return (
    <div className="mb-4">
      {group.collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mb-1.5 flex w-full items-center gap-1.5 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {group.label}
        </button>
      ) : (
      <p className="mb-1.5 flex items-center gap-1.5 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        <span className="h-1 w-1 rounded-full bg-primary/60" />
        {group.label}
      </p>
      )}
      {open && <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-1 px-2"
          >
            {group.items.map((item) => (
              <SortableExpandedItem key={item.to} item={item} />
            ))}
          </motion.ul>
        </SortableContext>
      </DndContext>}
    </div>
  );
}
