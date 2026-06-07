import { createContext, useContext } from "react";
import { motion } from "framer-motion";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { springSnappy, staggerItem } from "@/lib/motion";
import { useTabsStore, selectActivePath } from "@/store/tabs";
import { useTabTarget } from "./tabs/use-tab-target";
import type { NavItem } from "./nav-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Sidebar'daki tüm item path'leri — aktif hesaplamasında parent/child çakışmasını önler. */
export const SidebarPathsCtx = createContext<string[]>([]);

/** Aktiflik: tam eşleşme ya da daha spesifik bir kardeş yoksa prefix eşleşmesi. */
function useSidebarActive(to: string): boolean {
  const activePath = useTabsStore(selectActivePath);
  const allPaths = useContext(SidebarPathsCtx);
  const isPrefixActive = to !== "/" && (activePath?.startsWith(to + "/") ?? false);
  const hasMoreSpecificMatch =
    isPrefixActive &&
    allPaths.some(
      (p) =>
        p !== to &&
        p.startsWith(to + "/") &&
        (activePath === p || activePath?.startsWith(p + "/")),
    );
  return activePath === to || (isPrefixActive && !hasMoreSpecificMatch);
}

/** Sayısal rozet — bekleyen iş/uyarı sayısı (veri bağlandığında dolar). */
function SidebarBadge({ value, active }: { value: number; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
        active
          ? "bg-primary-foreground/20 text-primary-foreground"
          : "bg-primary/15 text-primary",
      )}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** Genişletilmiş nav satırı — aktifken dolu gradient pill (layoutId ile kayar) + glow. */
export function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const target = useTabTarget(item.to);
  const isActive = useSidebarActive(item.to);
  return (
    <button
      type="button"
      {...target}
      className={cn(
        "group relative flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        isActive
          ? "text-primary-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {isActive && (
        <motion.span
          layoutId="sidebar-active-pill"
          className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary to-primary/80 shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.7)]"
          transition={springSnappy}
        />
      )}
      <Icon className="relative z-10 h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110" />
      <span className="relative z-10 flex-1 truncate text-left">{item.label}</span>
      <span className="relative z-10 ml-auto flex items-center gap-1.5">
        {item.badge ? <SidebarBadge value={item.badge} active={isActive} /> : null}
        {isActive && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />}
      </span>
    </button>
  );
}

/** Daraltılmış nav ikon-butonu — aktifken gradient kare + glow; tooltip ile etiket. */
export function CollapsedItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const target = useTabTarget(item.to);
  const isActive = useSidebarActive(item.to);
  return (
    <motion.li variants={staggerItem} className="flex w-full justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            {...target}
            className={cn(
              "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              isActive
                ? "text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {isActive && (
              <motion.span
                layoutId="sidebar-active-pill-collapsed"
                className="absolute inset-0 rounded-lg bg-gradient-to-br from-primary to-primary/80 shadow-[0_6px_18px_-8px_hsl(var(--primary)/0.7)]"
                transition={springSnappy}
              />
            )}
            <Icon
              size={18}
              strokeWidth={2}
              aria-hidden
              className="relative z-10 transition-transform duration-200 group-hover:scale-110"
            />
            {item.badge ? (
              <span className="absolute right-1 top-1 z-10 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-card" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    </motion.li>
  );
}

/** Sürüklenebilir genişletilmiş öğe — dnd transform li'de, giriş animasyonu iç motion.div'de
 *  (çakışmayı önlemek için ayrı katman). */
export function SortableExpandedItem({ item }: { item: NavItem }) {
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
      <motion.div variants={staggerItem}>
        <NavItemLink item={item} />
      </motion.div>
    </li>
  );
}
