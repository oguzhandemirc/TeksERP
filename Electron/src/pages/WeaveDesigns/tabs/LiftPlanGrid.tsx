// Armür ızgarası çizimi: başlıkta çerçeve no (döner turuncu, kenar yeşil "1K"), gövdede kaldırma hücreleri,
// sağda salt-okunur atkı seçici bloğu (1./2./3., iplik renginde). Fare olayları üstte tek dinleyicide çözülür
// (`data-pick`/`data-frame` hücre, `data-leno` başlık): basılı sürükleme boyar/siler ya da seçer; bırakma
// pencere düzeyinde dinlenir (ızgara dışında bırakılsa da vuruş biter). `direction` yalnız ÇİZİM sırasını çevirir.
import { memo, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { rowsInDisplayOrder, type WeaveDirection } from "@/components/weave/weave-direction";
import { yarnColor } from "@/components/weave/weave-palette";
import { cn } from "@/lib/utils";
import type { Cell, Rect } from "../lift-plan-edit";
import type { LiftPlan } from "../types";

const CELL = "h-4 w-4 shrink-0 border border-border/60";
const HEAD = "h-4 w-4 shrink-0 text-center text-[9px] leading-4 tabular-nums";
const EMPTY_SET: ReadonlySet<number> = new Set();

interface Props {
  plan: LiftPlan;
  frames: number;
  rows: number;
  leno: ReadonlySet<number>;
  /** Kenar (K) çerçeveleri; yok = işaret yok (eski çağıranlar). */
  selvedge?: ReadonlySet<number>;
  /** Atkı başına 1-tabanlı iplik no; null = seçici yok. */
  selector: number[] | null;
  selCount: number;
  canWrite: boolean;
  /** Varsayılan "top-down" (eski çağıranlar için bugünkü çizim). */
  direction?: WeaveDirection;
  selection?: Rect | null;
  cursor?: Cell | null;
  /** Hücreye basıldı (select = Shift basılı). */
  onCellDown?: (cell: Cell, select: boolean) => void;
  /** Basılıyken başka hücreye geçildi. */
  onCellEnter?: (cell: Cell) => void;
  onStrokeEnd?: () => void;
  onLenoToggle?: (frame: number) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

function headTitle(isLeno: boolean, isSelv: boolean, canWrite: boolean): string | undefined {
  if (isLeno) return canWrite ? "Döner çerçeve — tıklayınca kenar olur" : "Döner çerçeve";
  if (isSelv) return canWrite ? "Kenar çerçevesi — tıklayınca zemin olur" : "Kenar çerçevesi";
  return canWrite ? "Döner çerçeve olarak işaretle (ikinci tıklama: kenar)" : undefined;
}

function HeaderRow({ frames, leno, selvedge, selCount, canWrite }: Pick<Props, "frames" | "leno" | "selCount" | "canWrite"> & { selvedge: ReadonlySet<number> }) {
  return (
    <div className="flex" role="row">
      <span className="w-10 shrink-0" />
      {Array.from({ length: frames }, (_, c) => {
        const isLeno = leno.has(c + 1);
        const isSelv = !isLeno && selvedge.has(c + 1);
        return (
          <div key={c} role="columnheader" data-leno={canWrite ? c + 1 : undefined} data-role={isLeno ? "leno" : isSelv ? "selvedge" : undefined}
            title={headTitle(isLeno, isSelv, canWrite)}
            className={cn(HEAD, isLeno ? "rounded-sm bg-amber-500 font-semibold text-white"
              // "12K" 16 px hücreye sığsın: küçük punto, sıkı aralık, taşma kırpılır.
              : isSelv ? "overflow-hidden whitespace-nowrap rounded-sm bg-emerald-600 text-[7px] font-semibold tracking-[-0.06em] text-white" : "text-muted-foreground", canWrite && "cursor-pointer")}>
            {c + 1}{isSelv ? "K" : ""}
          </div>
        );
      })}
      {selCount > 0 && <span className="w-3 shrink-0" />}
      {Array.from({ length: selCount }, (_, i) => (
        <div key={i} role="columnheader" className={cn(HEAD, "font-semibold text-foreground")}>{i + 1}.</div>
      ))}
    </div>
  );
}

interface RowProps {
  r: number; row: number[] | undefined; frames: number; leno: ReadonlySet<number>; selvedge: ReadonlySet<number>; pick: number | undefined; selCount: number;
  canWrite: boolean; selC0: number; selC1: number; cursorC: number;
}

/** Satır yalnız kendi verisi/seçimi/imleci değişince yeniden çizilir (512 satırlık ızgarada sürükleme akıcı). */
const GridRow = memo(function GridRow({ r, row, frames, leno, selvedge, pick, selCount, canWrite, selC0, selC1, cursorC }: RowProps) {
  return (
    <div className="flex" role="row" data-row={r}>
      <span className="w-10 shrink-0 pr-1 text-right text-[10px] tabular-nums text-muted-foreground">{r + 1}</span>
      {Array.from({ length: frames }, (_, c) => {
        const v = row?.[c];
        const sel = c >= selC0 && c <= selC1;
        return (
          <div key={c} role="gridcell" aria-selected={v === 1} data-pick={v === undefined ? undefined : r} data-frame={c}
            className={cn(CELL, v === 1 ? "bg-foreground" : leno.has(c + 1) ? "bg-amber-100 dark:bg-amber-950"
              : selvedge.has(c + 1) ? "bg-emerald-100 dark:bg-emerald-950" : "bg-background",
              // Seçim iplik renginden ayrışsın: dolu kare koyu kalır, çerçeve çizgisi; boş kare açık ton.
              sel && (v === 1 ? "border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]" : "border-primary/60 bg-primary/20"), c === cursorC && "outline outline-2 -outline-offset-1 outline-primary",
              canWrite && v !== undefined && "cursor-crosshair")} />
        );
      })}
      {selCount > 0 && <span className="w-3 shrink-0" />}
      {Array.from({ length: selCount }, (_, i) => {
        const on = pick === i + 1;
        return (
          <div key={i} role="gridcell" aria-label={`Atkı ${r + 1}: ${i + 1}. iplik`} aria-selected={on}
            className={cn(CELL, !on && "bg-muted/50")} style={on ? { background: yarnColor(i + 1) } : undefined} />
        );
      })}
    </div>
  );
});

function cellOf(target: EventTarget | null): Cell | null {
  const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-pick]");
  return el ? { r: Number(el.dataset.pick), c: Number(el.dataset.frame) } : null;
}

export function LiftPlanGrid(props: Props) {
  const { plan, frames, rows, leno, selvedge = EMPTY_SET, selector, selCount, canWrite, direction = "top-down", selection, cursor } = props;
  const header = <HeaderRow frames={frames} leno={leno} selvedge={selvedge} selCount={selCount} canWrite={canWrite} />;
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const handlers = useRef(props);
  useLayoutEffect(() => { handlers.current = props; });
  // Alttan yukarı görünümde 1. atkı en altta: uzun ızgara kutusu açılışta alta kaydırılır.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = direction === "bottom-up" ? el.scrollHeight : 0;
  }, [direction]);
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      handlers.current.onStrokeEnd?.();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canWrite || e.button > 0) return; // yalnız sol tık / dokunma
    const lenoEl = (e.target as HTMLElement).closest<HTMLElement>("[data-leno]");
    if (lenoEl) { props.onLenoToggle?.(Number(lenoEl.dataset.leno)); return; }
    const cell = cellOf(e.target);
    if (!cell) return;
    e.preventDefault(); // metin seçimi başlamasın
    box.current?.focus({ preventScroll: true });
    dragging.current = true;
    props.onCellDown?.(cell, e.shiftKey === true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const cell = cellOf(e.target);
    if (cell) props.onCellEnter?.(cell);
  };
  return (
    <div ref={box} tabIndex={canWrite ? 0 : undefined} onKeyDown={props.onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      className="max-h-[70vh] w-fit max-w-full touch-none select-none overflow-auto rounded-md border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      role="grid" aria-label="Armür ızgarası" aria-multiselectable={canWrite || undefined}>
      {direction === "top-down" && header}
      {rowsInDisplayOrder(rows, direction).map((r) => {
        const inSel = !!selection && r >= selection.r0 && r <= selection.r1;
        return (
          <GridRow key={r} r={r} row={plan[r]} frames={frames} leno={leno} selvedge={selvedge} pick={selector?.[r]} selCount={selCount} canWrite={canWrite}
            selC0={inSel ? selection.c0 : -1} selC1={inSel ? selection.c1 : -2} cursorC={canWrite && cursor?.r === r ? cursor.c : -1} />
        );
      })}
      {direction === "bottom-up" && header}
    </div>
  );
}
