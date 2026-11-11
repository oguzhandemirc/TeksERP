import { useEffect, useState, type MouseEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTabsStore, selectActivePath } from "@/store/tabs";
import { IconTile } from "@/components/ui/icon-tile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NavChild, NavItem } from "./nav-config";
import { navRowClass, navTone, useNavTarget } from "./sidebar-items";

// T5 bölüm kökü (Satış · Üretim · Depo · Sevkiyat): kökün kendisi bölüm kart sayfasını açar, yanındaki
// ok alt listeyi menüde açar/kapatır; daraltılmış menüde alt liste yana açılan panelde (flyout) gelir.

/** Aktif alt öğe: tam eşleşme ya da en uzun ön ek (detay sayfası `/x/:id` üst ekranını yakar). */
export function activeChildOf(children: NavChild[], activePath: string | null | undefined): string | null {
  if (!activePath) return null;
  const hits = children.filter((c) => activePath === c.to || activePath.startsWith(`${c.to}/`));
  return hits.sort((a, b) => b.to.length - a.to.length)[0]?.to ?? null;
}

function useSectionState(item: NavItem) {
  const activePath = useTabsStore(selectActivePath);
  const children = item.children ?? [];
  const activeChild = activeChildOf(children, activePath);
  return { activeChild, active: activePath === item.to || activeChild !== null };
}

// Panel (flyout) menü dışında, açılır yüzeyde çizilir → menü stili (koyu/birincil) renkleri orada kullanılmaz.
function ChildLink({ child, active, inPopover }: { child: NavChild; active: boolean; inPopover?: boolean }) {
  const target = useNavTarget(child);
  const Icon = child.icon;
  return (
    <li>
      <button
        type="button"
        {...target}
        data-nav-child=""
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          child.offHint && "opacity-50",
          active
            ? "bg-primary-soft font-semibold text-primary-soft-foreground"
            : inPopover
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{child.label}</span>
        {child.offHint ? <span className="text-[10px] font-normal">kapalı</span> : null}
      </button>
    </li>
  );
}

function ChildList(props: { item: NavItem; activeChild: string | null; className?: string; inPopover?: boolean }) {
  const { item, activeChild, className, inPopover } = props;
  return (
    <ul className={cn("space-y-0.5", className)}>
      {(item.children ?? []).map((c) => (
        <ChildLink key={c.to} child={c} active={c.to === activeChild} inPopover={inPopover} />
      ))}
    </ul>
  );
}

/** Genişletilmiş menüde bölüm kökü + açılır alt liste. */
export function SectionNavItem({ item }: { item: NavItem }) {
  const target = useNavTarget(item);
  const { active, activeChild } = useSectionState(item);
  const [open, setOpen] = useState(activeChild !== null);
  // Alt sayfaya başka yoldan (palet, kart) gidilince bölüm kendiliğinden açılır; kullanıcı kapatabilir.
  useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);
  return (
    <div>
      <div data-nav-active={active ? "true" : undefined} className={cn(navRowClass(active), "h-10 pr-1")}>
        <button
          type="button"
          {...target}
          aria-current={active ? "page" : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg pl-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconTile icon={item.icon} tone={navTone(item)} size="sm" />
          <span className="flex-1 truncate">{item.label}</span>
        </button>
        <button
          type="button"
          data-nav-toggle=""
          aria-expanded={open}
          aria-label={`${item.label} alt menüsü`}
          onClick={() => setOpen((v) => !v)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-150 motion-reduce:transition-none", !open && "-rotate-90")}
            aria-hidden
          />
        </button>
      </div>
      {open ? <ChildList item={item} activeChild={activeChild} className="ml-[1.3rem] mt-0.5 border-l border-sidebar-border pl-2.5" /> : null}
    </div>
  );
}

/** Daraltılmış menüde bölüm kökü: tık yana açılan paneli açar (başlığı bölüm sayfasına gider). */
export function CollapsedSectionItem({ item }: { item: NavItem }) {
  const rootTarget = useNavTarget(item);
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
        <PopoverContent side="right" align="start" sideOffset={10} className="w-64 p-2" onClick={closeOnPick}>
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
