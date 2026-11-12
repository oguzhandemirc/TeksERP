import { createContext, useContext, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useTabsStore, selectActivePath } from "@/store/tabs";
import { useTabTarget } from "./tabs/use-tab-target";
import type { NavItem } from "./nav-config";
import { IconTile, toneForKey } from "@/components/ui/icon-tile";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { NavContextMenu } from "./sidebar-context-menu";

/** UX-2 K3: kapalı modül satırı gezinmez; tıkta "kapalı — <ayar yolu>" der (HubCard ile aynı davranış). */
export function useNavTarget(item: Pick<NavItem, "to" | "offHint">) {
  const { onContextMenu: _bgTab, ...target } = useTabTarget(item.to);
  const hint = item.offHint;
  // Sağ tık menüde arka plan sekmesi açmaz → bağlam menüsü (`NavContextMenu`); orta/Ctrl+tık yeni sekme kalır.
  return hint ? { onClick: () => toast.info(hint), title: hint, "aria-disabled": true as const } : target;
}

/** Sidebar'daki tüm item path'leri — aktif hesaplamasında parent/child çakışmasını önler. */
export const SidebarPathsCtx = createContext<string[]>([]);

/** Aktiflik: tam eşleşme ya da daha spesifik bir kardeş yoksa prefix eşleşmesi. */
export function useSidebarActive(to: string): boolean {
  const activePath = useTabsStore(selectActivePath);
  const allPaths = useContext(SidebarPathsCtx);
  const isPrefixActive = to !== "/" && (activePath?.startsWith(to + "/") ?? false);
  const hasMoreSpecificMatch =
    isPrefixActive &&
    allPaths.some(
      (p) => p !== to && p.startsWith(to + "/") && (activePath === p || activePath?.startsWith(p + "/")),
    );
  return activePath === to || (isPrefixActive && !hasMoreSpecificMatch);
}

/** Sayısal rozet — bekleyen iş/uyarı sayısı (veri bağlandığında dolar). */
function SidebarBadge({ value }: { value: number }) {
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-soft px-1.5 text-[10px] font-semibold tabular-nums text-primary-soft-foreground">
      {value > 99 ? "99+" : value}
    </span>
  );
}

export const navTone = (item: NavItem) => item.tone ?? toneForKey(item.to);

/** Satır görünümü — seçili: birincil degrade + beyaz yazı; değilse menü yazısı + hafif zemin. */
export function navRowClass(active: boolean, off?: boolean) {
  return cn(
    "group relative flex w-full items-center rounded-lg text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    off && "opacity-50",
    active ? "nav-active-fill" : "text-sidebar-foreground hover:bg-sidebar-accent",
  );
}

/** Genişletilmiş nav satırı — simge karesi + etiket; `trailing` (alt menü oku) satırın sağında. */
export function NavItemLink({ item, active: activeProp }: { item: NavItem; active?: boolean }) {
  const target = useNavTarget(item);
  const selfActive = useSidebarActive(item.to);
  const isActive = activeProp ?? selfActive;
  return (
    <NavContextMenu to={item.to} label={item.label} disabled={Boolean(item.offHint)}>
      <button
        type="button"
        {...target}
        data-nav-active={isActive ? "true" : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(navRowClass(isActive, Boolean(item.offHint)), "h-10 gap-3 px-1.5")}
      >
        <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <span className="ml-auto flex items-center gap-1.5 pr-1">
          {item.offHint ? <span className="text-[10px] font-normal">kapalı</span> : null}
          {item.badge ? <SidebarBadge value={item.badge} /> : null}
        </span>
      </button>
    </NavContextMenu>
  );
}

/** Daraltılmış nav düğmesi — simge karesi; tooltip ile etiket. */
export function CollapsedItem({ item }: { item: NavItem }) {
  const target = useNavTarget(item);
  const isActive = useSidebarActive(item.to);
  return (
    <li className="flex w-full justify-center">
      <Tooltip>
        <NavContextMenu to={item.to} label={item.label} disabled={Boolean(item.offHint)}>
          <TooltipTrigger asChild>
            <button
              type="button"
              {...target}
              aria-label={item.label}
              data-nav-active={isActive ? "true" : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(navRowClass(isActive, Boolean(item.offHint)), "h-11 w-11 justify-center")}
            >
              <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
              {item.badge ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-sidebar" />
              ) : null}
            </button>
          </TooltipTrigger>
        </NavContextMenu>
        <TooltipContent side="right" sideOffset={8}>
          {item.offHint ? `${item.label} · ${item.offHint}` : item.label}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/** Sürüklenebilir genişletilmiş öğe — dnd transform li'de; yalnız dikey eksende kayar. */
export function SortableExpandedItem({ item, children }: { item: NavItem; children?: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className="touch-none"
      {...attributes}
      {...listeners}
    >
      {children ?? <NavItemLink item={item} />}
    </li>
  );
}
