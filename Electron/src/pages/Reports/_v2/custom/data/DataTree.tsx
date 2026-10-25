import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Clock, GripVertical, Plus, Search, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { foldedIncludes } from "@/lib/search-fold";
import { cn } from "@/lib/utils";
import type { CatalogCube } from "../custom-api";
import { fieldId, fieldName, WELL_LABELS, type DataField, type DropVerdict, type WellKind } from "./wells-model";

export interface AddTarget {
  well: WellKind;
  verdict: DropVerdict;
}

interface Props {
  /** Katalog ucunun cevabı OLDUĞU GİBİ — izin/modül süzmesi sunucuda yapıldı, burada yapılmaz. */
  cubes: CatalogCube[] | undefined;
  loading: boolean;
  failed: boolean;
  activeCube: string | null;
  /** Seçili bölüm yoksa boş; her kuyu için bırakma kuralının hükmü. */
  targetsFor: (field: DataField) => AddTarget[];
  onAdd: (field: DataField, well: WellKind) => void;
}

export const fieldDragId = (f: DataField) => `alan:${f.cube}:${f.kind}:${fieldId(f)}`;

function AddMenu({ field, targets, onAdd }: { field: DataField; targets: AddTarget[]; onAdd: Props["onAdd"] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-1.5" aria-label={`${fieldName(field)} alanını ekle`} disabled={targets.length === 0} title={targets.length ? "Kuyuya ekle" : "Önce düzende bir bölüm seçin"}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">“{fieldName(field)}” nereye?</DropdownMenuLabel>
        {targets.map((t) => (
          <DropdownMenuItem key={t.well} disabled={!t.verdict.ok} onSelect={() => onAdd(field, t.well)} className="flex flex-col items-start gap-0.5">
            <span>{WELL_LABELS[t.well]}</span>
            {!t.verdict.ok ? <span className="text-xs text-muted-foreground">{t.verdict.message}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FieldLeaf({ field, targets, onAdd }: { field: DataField; targets: AddTarget[]; onAdd: Props["onAdd"] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: fieldDragId(field), data: { field } });
  const hint = field.kind === "measure" ? field.measure.aciklama : field.dimension.tur === "zaman" ? "Zaman kırılımı" : "Kategori kırılımı";
  return (
    <li className={cn("flex items-center gap-1 rounded-md pr-1 hover:bg-muted/60", isDragging && "opacity-50")} data-testid="veri-alani" data-alan={fieldId(field)}>
      <button type="button" ref={setNodeRef} {...listeners} {...attributes} aria-label={`${fieldName(field)} — sürükleyin`} className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 px-1.5 py-1 text-left text-sm touch-none">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {field.kind === "dimension" ? (field.dimension.tur === "zaman" ? <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />) : null}
        <span className="min-w-0 flex-1 truncate" title={hint}>
          {fieldName(field)}
        </span>
        {field.kind === "measure" && field.measure.birim ? <span className="shrink-0 rounded border px-1 text-[0.65rem] text-muted-foreground">{field.measure.birim}</span> : null}
        <span className="sr-only">{hint}</span>
      </button>
      <AddMenu field={field} targets={targets} onAdd={onAdd} />
    </li>
  );
}

interface CubeProps {
  cube: CatalogCube;
  term: string;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  targetsFor: Props["targetsFor"];
  onAdd: Props["onAdd"];
}

function CubeNode({ cube, term, open, active, onToggle, targetsFor, onAdd }: CubeProps) {
  const match = (name: string, extra = "") => !term || foldedIncludes(name, term) || foldedIncludes(extra, term);
  const measures: DataField[] = cube.olculer.filter((m) => match(m.ad, m.aciklama)).map((m) => ({ cube: cube.kimlik, kind: "measure", measure: m }));
  const dims: DataField[] = cube.boyutlar.filter((d) => match(d.ad)).map((d) => ({ cube: cube.kimlik, kind: "dimension", dimension: d }));
  if (term && measures.length + dims.length === 0) return null;
  const expanded = open || Boolean(term);
  const group = (title: string, fields: DataField[]) =>
    fields.length ? (
      <div>
        <p className="px-1.5 pt-1 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <ul>
          {fields.map((f) => (
            <FieldLeaf key={fieldDragId(f)} field={f} targets={targetsFor(f)} onAdd={onAdd} />
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <li data-testid="veri-kupu" data-kup={cube.kimlik}>
      <button type="button" aria-expanded={expanded} onClick={onToggle} className={cn("flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-muted/60", active && "text-primary")}>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{cube.ad}</span>
        {active ? <span className="shrink-0 text-[0.65rem] font-normal text-muted-foreground">bu bölüm</span> : null}
      </button>
      {expanded ? (
        <div className="ml-2 border-l pl-1">
          {group("Ölçüler", measures)}
          {group("Boyutlar", dims)}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Veri paneli (VeriAgaci): küp → ölçüler / boyutlar, arama, birim rozeti, açıklama ipucu. Alan sürüklenip
 * kuyuya bırakılır ya da "+" menüsüyle eklenir (klavye yolu). Görünen her alan katalog cevabındandır.
 */
export function DataTree({ cubes, loading, failed, activeCube, targetsFor, onAdd }: Props) {
  const [term, setTerm] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const list = useMemo(() => cubes ?? [], [cubes]);
  const isOpen = (id: string) => toggled[id] ?? id === activeCube;
  return (
    <section aria-label="Veri alanları" className="flex min-w-0 flex-col gap-2 rounded-lg border p-2">
      <h2 className="px-1 text-sm font-semibold">Veri</h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Alan ara…" aria-label="Alan ara" className="h-8 pl-7 text-sm" />
      </div>
      {loading ? <p className="px-1 text-xs text-muted-foreground">Veri alanları yükleniyor…</p> : null}
      {failed ? <p className="px-1 text-xs text-destructive">Veri alanları alınamadı; sayfayı yenileyin.</p> : null}
      {!loading && !failed && list.length === 0 ? <p className="px-1 text-xs text-muted-foreground">Görebileceğiniz veri alanı yok. Rapor izinleriniz için yöneticinize başvurun.</p> : null}
      <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-auto" aria-label="Küpler">
        {list.map((c) => (
          <CubeNode key={c.kimlik} cube={c} term={term.trim()} open={isOpen(c.kimlik)} active={c.kimlik === activeCube} onToggle={() => setToggled((t) => ({ ...t, [c.kimlik]: !isOpen(c.kimlik) }))} targetsFor={targetsFor} onAdd={onAdd} />
        ))}
      </ul>
      {term.trim() && list.length > 0 && !list.some((c) => [...c.olculer.map((m) => m.ad + " " + m.aciklama), ...c.boyutlar.map((d) => d.ad)].some((n) => foldedIncludes(n, term.trim()))) ? (
        <p className="px-1 text-xs text-muted-foreground">“{term.trim()}” ile eşleşen alan yok.</p>
      ) : null}
      <p className="px-1 text-[0.7rem] text-muted-foreground">Alanı sağdaki kuyulara sürükleyin ya da “+” ile ekleyin.</p>
    </section>
  );
}
