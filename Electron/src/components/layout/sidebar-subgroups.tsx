import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavChild, NavChildGroup } from "./nav-config";

// Süreç alt grubu (Üretim › Dokuma …): genişletilmiş menüde başlık açılır düğmedir; açık gruplar bu cihazda
// hatırlanır, etkin ekranın grubu kendiliğinden açılır. Daraltılmış menünün panelinde başlık yalnız etikettir.

const STORE_KEY = "tekserp.nav.openSubgroups";

function readOpen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    const s = readOpen();
    if (open) s.add(id);
    else s.delete(id);
    localStorage.setItem(STORE_KEY, JSON.stringify([...s]));
  } catch {
    /* depolama yoksa yalnız oturumluk durum */
  }
}

function useSubgroupOpen(id: string, hasActive: boolean) {
  const [open, setOpenState] = useState(() => hasActive || readOpen().has(id));
  useEffect(() => {
    if (hasActive) setOpenState(true);
  }, [hasActive]);
  const setOpen = (v: boolean) => {
    setOpenState(v);
    writeOpen(id, v);
  };
  return [open, setOpen] as const;
}

/** Alt grup başlıklı mı çizilmeli — tek başlıksız grup düz listedir. */
export function hasSubgroupHeads(groups: NavChildGroup[] | undefined): groups is NavChildGroup[] {
  return Boolean(groups && groups.some((g) => g.label));
}

export function NavSubgroup(props: {
  rootTo: string;
  group: NavChildGroup;
  activeChild: string | null;
  inPopover?: boolean;
  renderChild: (child: NavChild) => ReactNode;
}) {
  const { rootTo, group, activeChild, inPopover, renderChild } = props;
  const hasActive = group.children.some((c) => c.to === activeChild);
  const [open, setOpen] = useSubgroupOpen(`${rootTo}#${group.key}`, hasActive);

  if (inPopover) {
    return (
      <li>
        <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {group.label}
        </p>
        <ul className="space-y-0.5">{group.children.map(renderChild)}</ul>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        data-nav-subgroup=""
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          hasActive ? "text-sidebar-foreground" : "text-sidebar-muted hover:text-sidebar-foreground",
        )}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        {!open ? <span className="text-[10px] font-normal normal-case tracking-normal opacity-70">{group.children.length}</span> : null}
      </button>
      {open ? <ul className="mb-1 space-y-0.5 pl-2">{group.children.map(renderChild)}</ul> : null}
    </li>
  );
}
