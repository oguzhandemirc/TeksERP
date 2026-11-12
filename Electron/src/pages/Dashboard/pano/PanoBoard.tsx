import { useMemo, type CSSProperties, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import type { PanoBoxDef } from "./box-types";
import { metaOf } from "./box-meta";
import { hasContent, hasRenderer, renderBox, type RenderCtx } from "./box-render";
import { BoxChrome, BoxFailed, BoxLoading, BoxMenu, PreviewSkeleton } from "./PanoBoxFrame";
import { BASE_SPAN, LOCAL_BOX_KEYS, moveBox, packRows, type SizeChoice } from "./pano-layout";
import { useMasonry } from "./pano-masonry";
import { SizePicker } from "./PanoSizePicker";
import type { BoxState } from "./usePanoBoxData";

/** 12 sütunlu ızgarada genişlik — Tailwind sınıfları statik kalsın diye tablo. Aralıklar çakışmaz: `md` (rem) ile
 *  `min-[1101px]` (px) Tailwind 4'te sıralanamıyor, `md` kazanıyordu. */
const SPAN: Record<number, string> = {
  1: "min-[1101px]:col-span-1", 2: "min-[1101px]:col-span-2", 3: "min-[1101px]:col-span-3", 4: "min-[1101px]:col-span-4",
  5: "min-[1101px]:col-span-5", 6: "min-[1101px]:col-span-6", 7: "min-[1101px]:col-span-7", 8: "min-[1101px]:col-span-8",
  9: "min-[1101px]:col-span-9", 10: "min-[1101px]:col-span-10", 11: "min-[1101px]:col-span-11", 12: "min-[1101px]:col-span-12",
};

interface Props {
  boxes: PanoBoxDef[];
  states: Record<string, BoxState>;
  editing: boolean;
  ctx: RenderCtx;
  onRemove: (key: string) => void;
  onReorder: (visibleOrder: string[]) => void;
  onResize: (key: string, size: SizeChoice) => void;
}

/** Kip dışında çizilecek mi: yerel kutu hep; uzak kutu yüklenirken/hatada iskelet, veri null/boşsa yok. */
function isShown(b: PanoBoxDef, s: BoxState | undefined, editing: boolean): boolean {
  if (!hasRenderer(b.anahtar)) return false;
  if (editing || LOCAL_BOX_KEYS.has(b.anahtar)) return true;
  if (!s) return false;
  return s.loading || s.error || hasContent(b.anahtar, s.data);
}

export function PanoBoard({ boxes, states, editing, ctx, onRemove, onReorder, onResize }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const shown = boxes.filter((b) => isShown(b, states[b.anahtar], editing));
  const kpis = shown.filter((b) => b.boyut === "kpi");
  const body = shown.filter((b) => b.boyut !== "kpi");
  const spans = new Map(packRows(body.map((b) => ({ key: b.anahtar, size: b.boyut as Exclude<PanoBoxDef["boyut"], "kpi"> }))).flat().map((p) => [p.key, p.span]));
  const bodyKey = body.map((b) => `${b.anahtar}:${b.boyut}:${spans.get(b.anahtar)}`).join(",");
  // Sütun akışında temel genişlik (gerilmemiş): satır artığını akış zaten dolduruyor. `bodyKey` kutu/boyut özeti.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flow = useMemo(() => body.map((b) => ({ key: b.anahtar, span: spanAt(BASE_SPAN[b.boyut as SizeChoice] ?? 4, b.boyut === "genis") })), [bodyKey]);
  const masonry = useMasonry(flow);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const order = shown.map((b) => b.anahtar);
    onReorder(moveBox(order, String(e.active.id), String(e.over.id)));
  };

  const cell = (b: PanoBoxDef) => {
    const s = states[b.anahtar];
    if (editing) return <EditCard def={b} onRemove={() => onRemove(b.anahtar)} onResize={(s) => onResize(b.anahtar, s)} />;
    const menu = <BoxMenu title={b.baslik} onRemove={() => onRemove(b.anahtar)} className={b.boyut === "kpi" ? "absolute right-3 top-3 z-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" : undefined} />;
    let content: ReactNode;
    if (LOCAL_BOX_KEYS.has(b.anahtar)) content = renderBox(b.anahtar, null, ctx);
    else if (s?.loading) content = b.boyut === "kpi" ? <KpiLoading /> : <BoxLoading title={b.baslik} kind={metaOf(b.anahtar).preview} />;
    else if (s?.error) content = <BoxFailed title={b.baslik} onRetry={s.refetch} />;
    else content = renderBox(b.anahtar, s?.data, ctx);
    if (b.boyut === "kpi") return <div className="group relative h-full">{content}{menu}</div>;
    return <BoxChrome menu={menu}>{content}</BoxChrome>;
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="space-y-[var(--space-gap)]" data-testid="pano-board" data-editing={editing || undefined}>
        {kpis.length > 0 && (
          <SortableContext items={kpis.map((b) => b.anahtar)} strategy={rectSortingStrategy}>
            {/* Eşit hücreli şerit: beş kompakt kart 1280 genişlikte tek sıra; taşan kart alt sıraya eşit genişlikte iner. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-[var(--space-gap)]" data-testid="pano-kpi-seridi">
              {kpis.map((b) => (
                <Cell key={b.anahtar} id={b.anahtar} editing={editing}>{cell(b)}</Cell>
              ))}
            </div>
          </SortableContext>
        )}
        {body.length > 0 && (
          <SortableContext items={body.map((b) => b.anahtar)} strategy={rectSortingStrategy}>
            {/* Sütun akışı: 4 px satır birimi + ölçülen boy → kısa kutunun altı boş kalmaz; boşluk hücre dolgusunda. */}
            <div ref={masonry.gridRef} className="grid auto-rows-[4px] gap-x-[var(--space-gap)] gap-y-0 min-[768px]:max-[1100px]:grid-cols-2 min-[1101px]:grid-cols-12" data-testid="pano-izgara">
              {flow.map((f, i) => { const b = body[i]!; return (
                <Cell key={b.anahtar} id={b.anahtar} editing={editing} measureRef={masonry.measure(b.anahtar)} place={masonry.styleOf(f.key)}
                  className={cn(b.boyut === "genis" && "min-[768px]:max-[1100px]:col-span-2", SPAN[spans.get(b.anahtar) ?? 4])}>{cell(b)}</Cell>
              ); })}
              
            </div>
          </SortableContext>
        )}
      </div>
    </DndContext>
  );
}

/** Sütun sayısına göre genişlik: 12'de paketlenmiş genişlik, 2'de geniş kutu iki sütun, tek sütunda 1. */
function spanAt(span12: number, wide: boolean): (cols: number) => number {
  return (cols) => (cols >= 12 ? span12 : cols === 2 && wide ? 2 : 1);
}

interface CellProps { id: string; editing: boolean; measureRef?: (el: HTMLDivElement | null) => void; place?: CSSProperties; className?: string; children: ReactNode }

function Cell({ id, editing, measureRef, place, className, children }: CellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, ...place };
  return (
    <div ref={setNodeRef} style={style} data-box={id}
      className={cn("min-w-0", isDragging && "z-20 opacity-80", className)}
      {...(editing ? { ...attributes, ...listeners, "aria-roledescription": "taşınabilir kutu" } : {})}>
      {measureRef ? <div ref={measureRef} className="pb-[var(--space-gap)]">{children}</div> : children}
    </div>
  );
}

function KpiLoading() {
  return (
    <div className="flex h-full items-center gap-3 rounded-xl border border-card-border bg-card px-[var(--kpi-px)] py-[var(--kpi-py)] shadow-card" data-testid="pano-kpi-iskelet">
      <div className="skeleton-shimmer h-10 w-10 shrink-0 rounded-xl bg-muted" />
      <div className="skeleton-shimmer min-w-0 flex-1"><PreviewSkeleton kind="kpi" /></div>
    </div>
  );
}

/** Düzenleme kipindeki kutu: tutamak + simge + başlık + ×, gövdede veri istemeyen önizleme iskeleti. */
function EditCard({ def, onRemove, onResize }: { def: PanoBoxDef; onRemove: () => void; onResize: (s: SizeChoice) => void }) {
  const meta = metaOf(def.anahtar);
  const kpi = def.boyut === "kpi";
  return (
    <section className={cn("flex h-full cursor-grab flex-col rounded-xl border-2 border-dashed border-primary/30 bg-card p-[var(--space-card)] shadow-card active:cursor-grabbing", !kpi && "min-h-48")}
      aria-label={def.baslik}>
      <header className="flex items-start gap-2">
        <GripVertical className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <IconTile icon={meta.icon} tone={meta.tone} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold">{def.baslik}</h2>
          {!kpi && <p className="line-clamp-1 text-xs text-muted-foreground">{def.aciklama}</p>}
        </div>
        <button type="button" aria-label={`${def.baslik} kutusunu kaldır`} onClick={onRemove} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className={cn("mt-3 flex-1", kpi && "mt-2")}><PreviewSkeleton kind={meta.preview} large={!kpi} /></div>
      {!kpi && <SizePicker title={def.baslik} value={def.boyut as SizeChoice} onChange={onResize} />}
    </section>
  );
}
