// Tezgah Salonu seçim katmanı: sağ tık menüsü, lasso dikdörtgeni, alt seçim çubuğu ve "⋯" menüsü.
// Üçü de AYNI eylem listesinden (`floorActionsOf`) çizilir. TV kipinde bu katman yoktur.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FloorHint } from "./FloorHint";
import {
  REPORTS_LINK,
  RUN_ACTION_KEYS,
  STOP_ACTION_KEYS,
  floorActionsOf,
  stopsLinkOf,
  type FloorAction,
  type FloorActionCtx,
  type RunActionKey,
  type StopActionKey,
} from "./floorActions";
import type { LiveLoom } from "./types";
import type { FloorSelectionState } from "./useFloorSelection";

export { useFloorSelection, type FloorSelectionState } from "./useFloorSelection";

/** Koşum eylemlerinin bağlamı — yalnız gerçek veride verilir (örnek veri ve TV'de koşum eylemi yok). */
export interface FloorJobs {
  /** Salon verisi tazelenebiliyor mu (C.15: değilse yazma eylemleri pasif). */
  online: boolean;
  looms: readonly LiveLoom[];
  /** Sunucu toplu duruş uçlarını tanıyor mu (değilse duruş eylemleri pasif — eski sunucu). */
  bulkStops: boolean;
  /** Sunucu "Sebep ata" uçlarını tanıyor mu (değilse eylem pasif — eski sunucu). */
  bulkClassify?: boolean;
  /** Seçili tezgahların HEPSİ (süzgeçte görünmeyenler dahil). */
  onAction: (key: RunActionKey | StopActionKey, ids: string[]) => void;
}

/** Seçimde açık koşumu olan tezgah sayısı; seçili bir tezgahın koşum bilgisi yoksa `null`. */
export function openRunLoomsOf(looms: readonly LiveLoom[], ids: ReadonlySet<string>): number | null {
  let n = 0;
  for (const l of looms) {
    if (!ids.has(l.id)) continue;
    if (l.openRuns == null) return null;
    if (l.openRuns.length > 0) n++;
  }
  return n;
}

/** Seçimde sebebi girilmemiş açık duruşu olan tezgah sayısı ("Sebep ata" hedefi). */
export function unclassifiedStopLoomsOf(looms: readonly LiveLoom[], ids: ReadonlySet<string>): number {
  return looms.filter((l) => ids.has(l.id) && l.openStop != null && l.openStop.reasonCode === null).length;
}

/** Seçimde açık duruşu olan tezgah sayısı. */
export function openStopLoomsOf(looms: readonly LiveLoom[], ids: ReadonlySet<string>): number {
  return looms.filter((l) => ids.has(l.id) && l.openStop != null).length;
}

function useActions(s: FloorSelectionState, jobs: FloorJobs | undefined): FloorAction[] {
  const dokumaEnabled = useDokumaEnabled();
  const { hasPermission } = useRoleAccess();
  const runs: FloorActionCtx["runs"] = jobs ? { online: jobs.online, openRunLooms: openRunLoomsOf(jobs.looms, s.sel.ids) } : undefined;
  const stops: FloorActionCtx["stops"] = jobs
    ? { online: jobs.online, bulk: jobs.bulkStops, openStopLooms: openStopLoomsOf(jobs.looms, s.sel.ids), bulkClassify: jobs.bulkClassify === true, unclassifiedStopLooms: unclassifiedStopLoomsOf(jobs.looms, s.sel.ids) }
    : undefined;
  return floorActionsOf({ count: s.sel.ids.size, dokumaEnabled, can: hasPermission, runs, stops });
}

const PANEL_ACTIONS: readonly string[] = [...RUN_ACTION_KEYS, ...STOP_ACTION_KEYS];
const isPanelAction = (k: FloorAction["key"]): k is RunActionKey | StopActionKey => PANEL_ACTIONS.includes(k);

function useRunAction(s: FloorSelectionState, onDetail: (id: string) => void, jobs: FloorJobs | undefined) {
  const navigate = useNavigate();
  return (key: FloorAction["key"]) => {
    const first = [...s.sel.ids][0];
    if (isPanelAction(key)) jobs?.onAction(key, [...s.sel.ids]);
    if (key === "detail" && first) onDetail(first);
    if (key === "stops" && first) void navigate(stopsLinkOf(first));
    if (key === "reports") void navigate(REPORTS_LINK);
    if (key === "selectAll") s.selectAll();
    if (key === "clear") s.clear();
  };
}

function ActionText({ a }: { a: FloorAction }) {
  return (
    <>
      <span>{a.label}</span>
      {a.reason && <span className="text-xs text-muted-foreground">{a.reason}</span>}
    </>
  );
}

interface AreaProps {
  s: FloorSelectionState;
  onDetail: (id: string) => void;
  /** Hol başlığından sağ tıkta "Bu holü seç" için: holün görünen tezgahları. */
  hallIds: (hall: string) => readonly string[];
  jobs?: FloorJobs;
  children: React.ReactNode;
}

/** Sağ tık alanı: kart üstünde açılırsa ve kart seçimde değilse seçim o karta iner (masaüstü alışkanlığı). */
export function FloorMenuArea({ s, onDetail, hallIds, jobs, children }: AreaProps) {
  const [hall, setHall] = useState<string | null>(null);
  const actions = useActions(s, jobs);
  const run = useRunAction(s, onDetail, jobs);
  const lp = s.longPress;
  const onContextMenu = (e: React.MouseEvent) => {
    // Dokunmatikte menü "⋯" düğmesindedir; uzun bas seçim kipidir.
    if (lp.lastWasTouch()) return e.preventDefault();
    const t = e.target as HTMLElement;
    const id = t.closest<HTMLElement>("[data-loom-id]")?.dataset.loomId;
    setHall(t.closest<HTMLElement>("[data-hall-header]")?.dataset.hallHeader ?? null);
    if (id && !s.sel.ids.has(id)) s.click(id, { toggle: false, range: false });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    s.lasso.onPointerDown(e);
    lp.onPointerDown(e);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        <div onPointerDown={onPointerDown} onPointerMove={lp.onPointerMove} onPointerUp={lp.onPointerEnd} onPointerCancel={lp.onPointerEnd} className="relative">
          {children}
          {s.lasso.box && (
            <div
              aria-hidden
              data-testid="lasso-box"
              className="pointer-events-none fixed z-[70] rounded-sm border border-primary bg-primary/15"
              style={{ left: s.lasso.box.left, top: s.lasso.box.top, width: s.lasso.box.right - s.lasso.box.left, height: s.lasso.box.bottom - s.lasso.box.top }}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuLabel>{s.sel.ids.size === 0 ? "Seçili tezgah yok" : `${s.sel.ids.size} tezgah seçili`}</ContextMenuLabel>
        <ContextMenuSeparator />
        {hall && <ContextMenuItem onSelect={() => s.many(hallIds(hall), false)}>Bu holü seç ({hall})</ContextMenuItem>}
        {actions.map((a) => (
          <ContextMenuItem key={a.key} disabled={!a.enabled} onSelect={() => run(a.key)} className="flex-col items-start gap-0">
            <ActionText a={a} />
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function BarButton({ a, run }: { a: FloorAction; run: (k: FloorAction["key"]) => void }) {
  if (a.enabled) {
    return (
      <Button size="sm" variant="outline" onClick={() => run(a.key)}>
        {a.label}
      </Button>
    );
  }
  return (
    <FloorHint hint={{ title: a.label, lines: [], note: a.reason ?? "" }}>
      <span tabIndex={0} aria-label={`${a.label} — ${a.reason}`}>
        <Button size="sm" variant="outline" disabled className="pointer-events-none">
          {a.label}
        </Button>
      </span>
    </FloorHint>
  );
}

/** Sağ tık menüsünün dokunmatik/klavye karşılığı: aynı liste, pasif öğe nedeniyle. */
function MoreMenu({ actions, run }: { actions: FloorAction[]; run: (k: FloorAction["key"]) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" aria-label="Diğer eylemler">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {actions.map((a) => (
          <DropdownMenuItem key={a.key} disabled={!a.enabled} onSelect={() => run(a.key)} className="flex-col items-start gap-0">
            <ActionText a={a} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BarProps {
  s: FloorSelectionState;
  onDetail: (id: string) => void;
  /** Görünen kartlar — seçili olup bu süzgeçte görünmeyenler sayılır (eylem onlara da uygulanır, gizli kalmaz). */
  order: readonly string[];
  jobs?: FloorJobs;
}

/** Seçim ≥1 iken alt yapışık çubuk; düğmeler ve "⋯" menüyle aynı listeden. */
export function SelectionBar({ s, onDetail, order, jobs }: BarProps) {
  const all = useActions(s, jobs);
  const run = useRunAction(s, onDetail, jobs);
  if (s.sel.ids.size === 0) return null;
  const hidden = [...s.sel.ids].filter((id) => !order.includes(id)).length;
  const notes = [hidden > 0 && `${hidden} tanesi bu süzgeçte görünmüyor`, s.dropped > 0 && `${s.dropped} tezgah artık listede yok`].filter(Boolean);
  return (
    <div role="toolbar" aria-label="Seçim çubuğu" className="sticky bottom-0 z-[65] flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="font-semibold tabular-nums">{s.sel.ids.size} tezgah seçili</span>
      {notes.length > 0 && <span className="text-sm text-muted-foreground">· {notes.join(" · ")}</span>}
      <div className="flex-1" />
      {all
        .filter((a) => a.key !== "clear")
        .map((a) => (
          <BarButton key={a.key} a={a} run={run} />
        ))}
      <MoreMenu actions={all} run={run} />
      <Button size="sm" variant="ghost" onClick={s.clear} aria-label={s.touchMode ? "Bitti — seçimi bırak" : "Seçimi bırak (Esc)"}>
        <X className="mr-1 h-4 w-4" />
        {s.touchMode ? "Bitti" : "Seçimi bırak"}
      </Button>
    </div>
  );
}
