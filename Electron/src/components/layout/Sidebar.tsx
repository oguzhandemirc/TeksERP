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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";
import logoUrl from "@/assets/teks-logo-fullsize.png";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useFavorites } from "@/hooks/useFavorites";
import { useMenuOrder } from "@/hooks/useMenuOrder";
import { useTabsStore, selectActivePath } from "@/store/tabs";
import { useTabTarget } from "./tabs/use-tab-target";
import { ADMIN_PERMISSION_LIST } from "@/types/auth";
import { navGroups, type NavItem, type NavGroup } from "./nav-config";
import { findCommandEntry, type CommandEntry } from "./command-entries";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface Props {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: Props) {
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();
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
    return true;
  };

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
      adminOnly: e.adminOnly,
    }))
    .filter(visible);
  const favGroup: NavGroup[] = favItems.length > 0 ? [{ label: "Favoriler", items: favItems }] : [];

  // Nav grupları — kullanıcı sürükle-bırak sırası uygulanır (localStorage).
  const navOrdered: NavGroup[] = navGroups
    .map((g) => ({ ...g, items: orderItems(g.label, g.items.filter(visible)) }))
    .filter((g) => g.items.length > 0);

  const groups = [...favGroup, ...navOrdered];

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border/60 bg-card/50 backdrop-blur-xl transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-56",
      )}
    >
      <SidebarBrand collapsed={collapsed} />

      <TooltipProvider delayDuration={150}>
        {collapsed ? (
          <CollapsedNav groups={groups} />
        ) : (
          <ExpandedNav groups={groups} onReorder={handleReorder} />
        )}
      </TooltipProvider>

      <Footer collapsed={collapsed} />
    </aside>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center border-b border-border/50",
        collapsed ? "justify-center px-2" : "gap-2.5 px-4",
      )}
    >
      <img
        src={logoUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
      />
      {!collapsed && (
        <span className="truncate text-sm font-bold tracking-tight">TeksERP</span>
      )}
    </div>
  );
}

function CollapsedNav({ groups }: { groups: NavGroup[] }) {
  return (
    <nav className="flex flex-1 flex-col items-center overflow-y-auto py-4">
      {groups.map((group, idx) => (
        <div key={group.label} className="flex w-full flex-col items-center">
          {idx > 0 && <div className="my-2 h-px w-8 bg-border/50" />}
          <ul className="flex w-full flex-col items-center gap-1.5">
            {group.items.map((item) => (
              <CollapsedItem key={item.to} item={item} />
            ))}
          </ul>
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

  return (
    <div className="mb-4">
      <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {group.label}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1 px-2">
            {group.items.map((item) => (
              <SortableExpandedItem key={item.to} item={item} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableExpandedItem({ item }: { item: NavItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        // Yalnız dikey sürükleme: yatay ekseni sıfırla (imleç sağa/sola gitse de öğe kaymaz).
        transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className="touch-none"
      {...attributes}
      {...listeners}
    >
      <NavItemLink item={item} />
    </li>
  );
}

function CollapsedItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const target = useTabTarget(item.to);
  const isActive = useTabsStore(selectActivePath) === item.to;
  return (
    <li style={{ display: "flex", justifyContent: "center", width: "100%" }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            {...target}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              borderRadius: 8,
              transition: "background-color 150ms, color 150ms",
            }}
            className={cn(
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const target = useTabTarget(item.to);
  const isActive = useTabsStore(selectActivePath) === item.to;
  return (
    <button
      type="button"
      {...target}
      className={cn(
        "relative flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        isActive
          ? "text-primary"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {isActive && (
        <motion.span
          layoutId="sidebar-active-pill"
          className="absolute inset-0 rounded-md bg-primary/10 ring-1 ring-inset ring-primary/25"
          transition={springSnappy}
        />
      )}
      <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
      <span className="relative z-10 truncate">{item.label}</span>
    </button>
  );
}

function Footer({ collapsed }: { collapsed: boolean }) {
  const handleClick = () => {
    void window.api?.system?.openExternal("https://etkiliyazilim.com");
  };

  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-border/50 py-3">
        <button
          type="button"
          onClick={handleClick}
          aria-label="Etkili Yazılım"
          title="etkiliyazilim.com"
          className="text-[10px] font-medium tracking-wider text-muted-foreground/50 transition-colors hover:text-foreground"
        >
          EY
        </button>
      </div>
    );
  }
  return (
    <div className="border-t border-border/50 py-3">
      <button
        type="button"
        onClick={handleClick}
        title="etkiliyazilim.com"
        className="px-4 text-[10px] text-muted-foreground/50 transition-colors hover:text-foreground"
      >
        by Etkili Yazılım
      </button>
    </div>
  );
}
