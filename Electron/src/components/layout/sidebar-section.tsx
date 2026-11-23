import { createContext, useContext, useEffect, useState, type MouseEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconTile } from "@/components/ui/icon-tile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NavChild, NavItem } from "./nav-config";
import { ActivePlacementCtx, NavOwnerCtx, navRowClass, navTone, useNavTarget, useRowTarget } from "./sidebar-items";
import { NavContextMenu } from "./sidebar-context-menu";
import { NavSubgroup, hasSubgroupHeads } from "./sidebar-subgroups";

// T5 bölüm kökü (Satış · Üretim · Depo · Sevkiyat): kökün kendisi bölüm kart sayfasını açar, yanındaki
// ok alt listeyi menüde açar/kapatır; daraltılmış menüde alt liste yana açılan panelde (flyout) gelir.

// Etkinlik Sidebar'ın çözdüğü TEK konumdan: aynı ekran iki kökte dursa da yalnız tıklanan kök yanar.
function useSectionState(item: NavItem) {
  const placement = useContext(ActivePlacementCtx);
  const owner = useContext(NavOwnerCtx);
  const activeChild = placement?.owner === item.to ? placement.to : null;
  const self = placement !== null && placement.owner === owner && placement.to === item.to;
  return { activeChild, active: self || activeChild !== null };
}

// Panel (flyout) menü dışında, açılır yüzeyde çizilir → menü stili (koyu/birincil) renkleri orada kullanılmaz.
function ChildLink({ child, root, active, inPopover, nested }: { child: NavChild; root: NavItem; active: boolean; inPopover?: boolean; nested?: boolean }) {
  const target = useNavTarget(child, { owner: root.to, to: child.to, ownerLabel: root.label });
  const Icon = child.icon;
  return (
    <li>
      <NavContextMenu to={child.to} label={child.label} disabled={Boolean(child.offHint)}>
        <button
          type="button"
          {...target}
          data-nav-child=""
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            child.offHint && "opacity-50",
            active
              ? cn(
                  "bg-primary-soft font-semibold text-primary-soft-foreground",
                  // Kılavuz çizgisi üstünde seçili işaret — kök + alt öğe birlikte okunur.
                  !inPopover &&
                    "before:absolute before:inset-y-1.5 before:w-[3px] before:rounded-full before:bg-primary",
                  // Alt grup içinde liste 0.5rem daha içeride: işaret yine kılavuz çizgisine oturur.
                  !inPopover && (nested ? "before:-left-[21px]" : "before:-left-[13px]"),
                )
              : inPopover
                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{child.label}</span>
          {child.offHint ? <span className="text-[10px] font-normal">kapalı</span> : null}
        </button>
      </NavContextMenu>
    </li>
  );
}

function ChildList(props: {
  item: NavItem;
  activeChild: string | null;
  className?: string;
  inPopover?: boolean;
}) {
  const { item, activeChild, className, inPopover } = props;
  // Süreç alt grupları varsa başlıklı bloklar (`sidebar-subgroups.tsx`); yoksa eski düz liste.
  if (hasSubgroupHeads(item.childGroups)) {
    return (
      <ul className={cn("space-y-0.5", className)}>
        {item.childGroups.map((g) => (
          <NavSubgroup
            key={g.key}
            rootTo={item.to}
            group={g}
            activeChild={activeChild}
            inPopover={inPopover}
            renderChild={(c) => <ChildLink key={c.to} child={c} root={item} active={c.to === activeChild} inPopover={inPopover} nested />}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className={cn("space-y-0.5", className)}>
      {(item.children ?? []).map((c) => (
        <ChildLink key={c.to} child={c} root={item} active={c.to === activeChild} inPopover={inPopover} />
      ))}
    </ul>
  );
}

/** Akordeon: genişletilmiş menüde aynı anda TEK bölüm açık (uzun alt listeler menüyü kaydırmasın). */
export const OpenSectionCtx = createContext<{
  open: string | null;
  setOpen: (to: string | null) => void;
} | null>(null);

function useSectionOpen(item: NavItem, active: boolean) {
  const shared = useContext(OpenSectionCtx);
  const [local, setLocal] = useState(active);
  const open = shared ? shared.open === item.to : local;
  const setOpen = (v: boolean) => (shared ? shared.setOpen(v ? item.to : null) : setLocal(v));
  // Bölüme (alt sayfa ya da kök kart sayfası) başka yoldan gelinince kendiliğinden açılır; kullanıcı kapatabilir.
  useEffect(() => {
    if (active) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız etkinleşme anında
  }, [active]);
  return [open, setOpen] as const;
}

/** Genişletilmiş menüde bölüm kökü + açılır alt liste. */
export function SectionNavItem({ item }: { item: NavItem }) {
  const target = useRowTarget(item);
  const { active, activeChild } = useSectionState(item);
  const [open, setOpen] = useSectionOpen(item, active);
  // Kökün KENDİ sayfası seçiliyse dolu degrade; alt öğesi seçiliyse kök yalnız vurgulanır (tek dolu satır).
  const selfActive = active && activeChild === null;
  const parentActive = active && !selfActive;
  return (
    <div>
      <div
        data-nav-active={selfActive ? "true" : undefined}
        data-nav-parent={parentActive ? "true" : undefined}
        className={cn(
          navRowClass(selfActive),
          "h-10 pr-1",
          parentActive && "bg-sidebar-accent font-semibold",
        )}
      >
        <NavContextMenu to={item.to} label={item.label} disabled={Boolean(item.offHint)}>
          <button
            type="button"
            {...target}
            aria-current={selfActive ? "page" : undefined}
            className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg pl-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        </NavContextMenu>
        <button
          type="button"
          data-nav-toggle=""
          aria-expanded={open}
          aria-label={`${item.label} alt menüsü`}
          onClick={() => setOpen(!open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-sidebar-accent hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-200 motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
        </button>
      </div>
      {open ? (
        <ChildList
          item={item}
          activeChild={activeChild}
          className="mb-1 ml-[1.35rem] mt-1 border-l-2 border-sidebar-border pl-2.5"
        />
      ) : null}
    </div>
  );
}

/** Daraltılmış menüde bölüm kökü: tık yana açılan paneli açar (başlığı bölüm sayfasına gider). */
export function CollapsedSectionItem({ item }: { item: NavItem }) {
  const rootTarget = useRowTarget(item);
  const { active, activeChild } = useSectionState(item);
  const [open, setOpen] = useState(false);
  // Paneldeki herhangi bir bağlantı seçilince panel kapanır.
  const closeOnPick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) setOpen(false);
  };
  return (
    <li className="flex w-full justify-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={item.label}
            aria-haspopup="menu"
            data-nav-active={active ? "true" : undefined}
            className={cn(navRowClass(active), "h-11 w-11 justify-center")}
          >
            <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={10} className="max-h-[80vh] w-64 overflow-y-auto p-2" onClick={closeOnPick}>
          <button
            type="button"
            {...rootTarget}
            className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
            <span className="flex-1 truncate">{item.label}</span>
            <span className="text-[11px] font-normal text-muted-foreground">tüm kartlar</span>
          </button>
          <ChildList item={item} activeChild={activeChild} inPopover />
        </PopoverContent>
      </Popover>
    </li>
  );
}
