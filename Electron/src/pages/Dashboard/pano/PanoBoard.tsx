import type { CSSProperties, ReactNode } from "react";
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
import { LOCAL_BOX_KEYS, moveBox, packRows } from "./pano-layout";
import type { BoxState } from "./usePanoBoxData";

/** 12 sütunlu ızgarada genişlik — Tailwind sınıfları statik kalsın diye tablo. Aralıklar çakışmaz: `md` (rem) ile
 *  `min-[1101px]` (px) Tailwind 4'te sıralanamıyor, `md` kazanıyordu. */
const SPAN: Record<number, string> = {
  1: "min-[1101px]:col-span-1", 2: "min-[1101px]:col-span-2", 3: "min-[1101px]:col-span-3", 4: "min-[1101px]:col-span-4",
  5: "min-[1101px]:col-span-5", 6: "min-[1101px]:col-span-6", 7: "min-[1101px]:col-span-7", 8: "min-[1101px]:col-span-8",
  9: "min-[1101px]:col-span-9", 10: "min-[1101px]:col-span-10", 11: "min-[1101px]:col-span-11", 12: "min-[1101px]:col-span-12",
};

const MONEY_KPIS: ReadonlySet<string> = new Set(["ciro", "tahsilat"]);

interface Props {
  boxes: PanoBoxDef[];
  states: Record<string, BoxState>;
  editing: boolean;
  ctx: RenderCtx;
  onRemove: (key: string) => void;
  onReorder: (visibleOrder: string[]) => void;
}

/** Kip dışında çizilecek mi: yerel kutu hep; uzak kutu yüklenirken/hatada iskelet, veri null/boşsa yok. */
function isShown(b: PanoBoxDef, s: BoxState | undefined, editing: boolean): boolean {
  if (!hasRenderer(b.anahtar)) return false;
  if (editing || LOCAL_BOX_KEYS.has(b.anahtar)) return true;
  if (!s) return false;
  return s.loading || s.error || hasContent(b.anahtar, s.data);
}

export function PanoBoard({ boxes, states, editing, ctx, onRemove, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const shown = boxes.filter((b) => isShown(b, states[b.anahtar], editing));
  const kpis = shown.filter((b) => b.boyut === "kpi");
  const body = shown.filter((b) => b.boyut !== "kpi");
  const spans = new Map(packRows(body.map((b) => ({ key: b.anahtar, size: b.boyut as Exclude<PanoBoxDef["boyut"], "kpi"> }))).flat().map((p) => [p.key, p.span]));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const order = shown.map((b) => b.anahtar);
    onReorder(moveBox(order, String(e.active.id), String(e.over.id)));
  };

  const cell = (b: PanoBoxDef) => {
    const s = states[b.anahtar];
    if (editing) return <EditCard def={b} onRemove={() => onRemove(b.anahtar)} />;
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
      <div className="space-y-4" data-testid="pano-board" data-editing={editing || undefined}>
        {kpis.length > 0 && (
          <SortableContext items={kpis.map((b) => b.anahtar)} strategy={rectSortingStrategy}>
            {/* Esnek şerit: beş kompakt kart 1280 genişlikte tek sıra; para kartı biraz daha geniş tabanla. */}
            <div className="flex flex-wrap gap-4" data-testid="pano-kpi-seridi">
              {kpis.map((b) => (
                <Cell key={b.anahtar} id={b.anahtar} editing={editing}
                  className={MONEY_KPIS.has(b.anahtar) ? "flex-[1_1_12rem]" : "flex-[1_1_10.5rem]"}>{cell(b)}</Cell>
              ))}
            </div>
          </SortableContext>
        )}
        {body.length > 0 && (
          <SortableContext items={body.map((b) => b.anahtar)} strategy={rectSortingStrategy}>
            <div className="grid gap-4 min-[768px]:max-[1100px]:grid-flow-row-dense min-[768px]:max-[1100px]:grid-cols-2 min-[1101px]:grid-cols-12">
              {body.map((b) => (
                <Cell key={b.anahtar} id={b.anahtar} editing={editing}
                  className={cn(b.boyut === "genis" && "min-[768px]:max-[1100px]:col-span-2", SPAN[spans.get(b.anahtar) ?? 4])}>{cell(b)}</Cell>
              ))}
            </div>
          </SortableContext>
        )}
      </div>
    </DndContext>
  );
}

function Cell({ id, editing, className, children }: { id: string; editing: boolean; className?: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} data-box={id}
      className={cn("min-w-0", isDragging && "z-20 opacity-80", className)}
      {...(editing ? { ...attributes, ...listeners, "aria-roledescription": "taşınabilir kutu" } : {})}>
      {children}
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
function EditCard({ def, onRemove }: { def: PanoBoxDef; onRemove: () => void }) {
  const meta = metaOf(def.anahtar);
  const kpi = def.boyut === "kpi";
  return (
    <section className={cn("flex h-full cursor-grab flex-col rounded-xl border-2 border-dashed border-primary/30 bg-card p-4 shadow-card active:cursor-grabbing", !kpi && "min-h-48")}
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
    </section>
  );
}
