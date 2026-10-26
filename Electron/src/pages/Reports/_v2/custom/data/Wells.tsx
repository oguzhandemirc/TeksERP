import { Fragment, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Filter, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CatalogCube } from "../custom-api";
import type { DefinitionBlock } from "../layout/layout-model";
import { useValueLabels } from "./dimension-values";
import { describeFilter, describeRule, fromQueryFilter, isGroup, leafFields } from "./filter-model";
import { suggestChart } from "./suggest-chart";
import { shapeOf, WELL_LABELS, wellContents, wellsFor, type DataField, type DropVerdict, type WellIssue, type WellKind } from "./wells-model";

const WELL_HINTS: Record<WellKind, string> = {
  satir: "Satırlara kırılım (bir boyut)",
  sutun: "Sütunlara ikinci kırılım",
  olcu: "Sayılacak ölçüler",
  suzgec: "Yalnız bu koşullara uyan kayıtlar",
  varyant: "Kartlara bölünecek tek boyut",
};

export const wellDropId = (w: WellKind) => `kuyu:${w}`;

interface WellBoxProps {
  well: WellKind;
  check: (field: DataField, well: WellKind) => DropVerdict;
  issues: WellIssue[];
  children: ReactNode;
  action?: ReactNode;
}

/** Bırakma alanı; üzerine gelen alan kuralı çiğniyorsa uyarı ANINDA burada görünür. */
function WellBox({ well, check, issues, children, action }: WellBoxProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id: wellDropId(well), data: { well } });
  const dragged = active?.data.current?.field as DataField | undefined;
  const verdict = isOver && dragged ? check(dragged, well) : null;
  return (
    <div
      ref={setNodeRef}
      data-testid={`kuyu-${well}`}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-dashed p-2 transition-colors",
        verdict?.ok && "border-primary bg-primary/5",
        verdict && !verdict.ok && "border-destructive bg-destructive/5",
        issues.length > 0 && !verdict && "border-destructive/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {WELL_LABELS[well]} <span className="font-normal text-muted-foreground">· {WELL_HINTS[well]}</span>
        </span>
        {action}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
      {verdict && !verdict.ok ? (
        <p role="alert" className="text-xs text-destructive">
          {verdict.message}
        </p>
      ) : null}
      {issues.map((i) => (
        <p key={i.mesaj} className="text-xs text-destructive">
          {i.mesaj}
        </p>
      ))}
    </div>
  );
}

function Chip({ label, error, onRemove, onClick, removeLabel }: { label: string; error?: string; onRemove?: () => void; onClick?: () => void; removeLabel: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pl-2 pr-1 text-xs", error && "border-destructive text-destructive")} title={error}>
      {onClick ? (
        <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={onClick}>
          {label}
        </button>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {onRemove ? (
        <button type="button" aria-label={removeLabel} className="rounded-full p-0.5 hover:bg-muted" onClick={onRemove}>
          <X className="h-3 w-3" />
        </button>
      ) : null}
      {error ? <span className="sr-only">{error}</span> : null}
    </span>
  );
}

const Empty = () => <span className="text-xs text-muted-foreground">Alan sürükleyin ya da ağaçtan “+” ile ekleyin.</span>;

interface Props {
  block: DefinitionBlock;
  cube: CatalogCube | undefined;
  issues: WellIssue[];
  /** Son reddedilen bırakmanın Türkçe gerekçesi (tıkla/klavye yolu ve bırakma anı). */
  warning: string | null;
  check: (field: DataField, well: WellKind) => DropVerdict;
  onRemove: (well: Exclude<WellKind, "suzgec">, id: string) => void;
  onRemoveFilter: (index: number) => void;
  onOpenFilter: () => void;
  onChart: (kind: string) => void;
}

/** Kuyular (Kuyular): seçili bölümün Satır/Sütun/Ölçü/Süzgeç/Varyant'ı + önerilen grafik. */
export function Wells({ block, cube, issues, warning, check, onRemove, onRemoveFilter, onOpenFilter, onChart }: Props) {
  const wells = wellsFor(block);
  const q = block.sorgu;
  const filter = fromQueryFilter(q?.suzgec);
  const labelOf = useValueLabels(q?.kup, q?.olculer[0], leafFields(filter));
  if (!q || wells.length === 0) return null;
  const contents = wellContents(block);
  const measureName = (id: string) => cube?.olculer.find((m) => m.kimlik === id)?.ad ?? id;
  const dimName = (id: string) => cube?.boyutlar.find((d) => d.kimlik === id)?.ad ?? id;
  const issueAt = (w: WellKind, i: number) => issues.find((x) => x.well === w && x.index === i)?.mesaj;
  const forWell = (w: WellKind) => issues.filter((x) => x.well === w);
  const labels = { field: dimName, value: labelOf };
  const suggestion = block.tur === "grafik" ? suggestChart(shapeOf(q, cube)) : null;
  const unplaced = issues.filter((x) => x.well === null);

  return (
    <section aria-label="Kuyular" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Bölümün verisi</h2>
      {wells.map((w) =>
        w === "suzgec" ? (
          <WellBox key={w} well={w} check={check} issues={forWell(w)} action={<Button type="button" size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-xs" onClick={onOpenFilter}><Filter className="h-3 w-3" /> Süzgeç kur</Button>}>
            {filter.rules.length === 0 ? <span className="text-xs text-muted-foreground">Süzgeç yok — tüm kayıtlar.</span> : null}
            {filter.rules.map((r, i) => (
              <Fragment key={i}>
                {i > 0 && filter.combinator === "or" ? <span className="self-center text-xs font-medium text-muted-foreground">veya</span> : null}
                <Chip label={isGroup(r) ? (r.rules.length > 1 ? `(${describeFilter(r, labels)})` : describeFilter(r, labels)) : describeRule(r, labels)} error={issueAt(w, i)} onClick={onOpenFilter} onRemove={() => onRemoveFilter(i)} removeLabel="Koşulu kaldır" />
              </Fragment>
            ))}
          </WellBox>
        ) : (
          <WellBox key={w} well={w} check={check} issues={forWell(w)}>
            {contents[w].length === 0 ? <Empty /> : null}
            {contents[w].map((id, i) => (
              <Chip key={id} label={w === "olcu" ? measureName(id) : dimName(id)} error={issueAt(w, i)} onRemove={w === "olcu" && contents.olcu.length === 1 ? undefined : () => onRemove(w, id)} removeLabel={`${w === "olcu" ? measureName(id) : dimName(id)} kaldır`} />
            ))}
          </WellBox>
        ),
      )}
      {warning ? (
        <p role="alert" aria-live="assertive" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          {warning}
        </p>
      ) : null}
      {unplaced.map((x) => (
        <p key={x.mesaj} className="text-xs text-destructive">{x.mesaj}</p>
      ))}
      {suggestion ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs" data-testid="onerilen-grafik">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            Önerilen: <strong>{suggestion.label}</strong> — {suggestion.reason}
          </span>
          {suggestion.kind !== "anaSayi" && block.gorsel !== suggestion.kind ? (
            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onChart(suggestion.kind)}>
              Uygula
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
