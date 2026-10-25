import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ParamPickerDialog } from "../../ParamPickerDialog";
import type { CatalogCube } from "../custom-api";
import { useDimensionOptions, useValueLabels } from "./dimension-values";
import {
  describeFilter,
  FILTER_CAPABILITIES,
  fromQueryFilter,
  isEditableFlat,
  isSingleValue,
  MAX_FILTER_RULES,
  OPERATOR_LABELS,
  toQueryFilter,
  type FilterGroup,
  type FilterOperator,
  type FilterRule,
} from "./filter-model";

interface Props {
  open: boolean;
  cube: CatalogCube;
  /** Değer listesini getiren sorgunun ölçüsü (bölümün ilk ölçüsü). */
  measure: string | undefined;
  /** Seçili ölçülerin süzebildiği boyutlar (yardımcı ölçü beyanı uygulanmış). */
  dimensions: CatalogCube["boyutlar"];
  initial: unknown;
  /** Kuyuya bırakılan alan: yeni satır bununla açılır. */
  seedField: string | null;
  onApply: (filter: FilterGroup | undefined) => void;
  onClose: () => void;
}

const opsOf = (dims: Props["dimensions"], field: string): FilterOperator[] => (dims.find((d) => d.kimlik === field)?.islecler ?? []) as FilterOperator[];
const defaultOp = (ops: FilterOperator[]): FilterOperator => (ops.includes("in") ? "in" : (ops[0] ?? "="));
const asList = (v: FilterRule["value"]) => (Array.isArray(v) ? v : v ? [v] : []);

interface RowProps {
  rule: FilterRule;
  index: number;
  combinator: FilterGroup["combinator"];
  cube: CatalogCube;
  measure: string | undefined;
  dimensions: Props["dimensions"];
  labelOf: (dim: string, v: string) => string;
  onPatch: (p: Partial<FilterRule>) => void;
  onToggleJoin: () => void;
  onRemove: () => void;
}

/** Tek satır: bağlaç · alan (modal) · işleç (düğmeler) · değer (modal; "içerir"de metin). */
function FilterRowEditor({ rule, index, combinator, cube, measure, dimensions, labelOf, onPatch, onToggleJoin, onRemove }: RowProps) {
  const [picker, setPicker] = useState<"field" | "value" | null>(null);
  const options = useDimensionOptions(cube.kimlik, measure, rule.field, picker === "value");
  const ops = opsOf(dimensions, rule.field);
  const fieldName = dimensions.find((d) => d.kimlik === rule.field)?.ad;
  const values = asList(rule.value);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-2" data-testid="suzgec-satiri">
      {index === 0 ? (
        <span className="w-12 text-xs text-muted-foreground">Koşul</span>
      ) : FILTER_CAPABILITIES.or ? (
        <Button type="button" size="sm" variant="outline" className="h-8 w-12 text-xs" onClick={onToggleJoin}>
          {combinator === "or" ? "veya" : "ve"}
        </Button>
      ) : (
        <span className="w-12 text-xs text-muted-foreground">ve</span>
      )}
      <Button type="button" size="sm" variant="outline" className="h-8 max-w-[12rem] truncate text-xs" onClick={() => setPicker("field")}>
        {fieldName ?? "Alan seç…"}
      </Button>
      <div className="flex flex-wrap gap-1" role="group" aria-label="İşleç">
        {ops.map((op) => (
          <button
            key={op}
            type="button"
            aria-pressed={rule.operator === op}
            onClick={() => onPatch({ operator: op, value: isSingleValue(op) ? (values[0] ?? "") : values })}
            className={cn("rounded-md border px-2 py-1 text-xs", rule.operator === op ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {OPERATOR_LABELS[op]}
          </button>
        ))}
      </div>
      {rule.field && rule.operator === "contains" ? (
        <Input aria-label="Aranan metin" className="h-8 w-40 text-xs" maxLength={200} value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => onPatch({ value: e.target.value })} />
      ) : rule.field ? (
        <Button type="button" size="sm" variant="outline" className="h-8 max-w-[14rem] truncate text-xs" onClick={() => setPicker("value")}>
          {values.length ? values.map((v) => labelOf(rule.field, v)).join(", ") : "Değer seç…"}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="ghost" className="ml-auto h-8" aria-label="Koşulu sil" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ParamPickerDialog
        open={picker === "field"}
        title="Hangi alana göre süzülsün?"
        options={dimensions.map((d) => ({ deger: d.kimlik, etiket: d.ad }))}
        multiple={false}
        allowAll={false}
        selected={rule.field ? [rule.field] : []}
        onApply={(v) => v[0] && v[0] !== rule.field && onPatch({ field: v[0], operator: defaultOp(opsOf(dimensions, v[0])), value: [] })}
        onClose={() => setPicker(null)}
      />
      <ParamPickerDialog
        open={picker === "value"}
        title={options.isLoading ? `${fieldName ?? ""} — değerler yükleniyor…` : options.isError ? `${fieldName ?? ""} — değer listesi alınamadı` : (fieldName ?? "Değer")}
        options={options.data ?? []}
        multiple={!isSingleValue(rule.operator)}
        allowAll={false}
        selected={values}
        onApply={(v) => onPatch({ value: isSingleValue(rule.operator) ? (v[0] ?? "") : v })}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

/**
 * Süzgeç kurucu (SuzgecKurucu): `alan · işleç · değer` satırları → `{combinator, rules}` (plan §3.2).
 * İstemci SQL kurmaz; JSON sunucuda derlenir. Kod modunda yazılmış iç gruplu süzgeç burada salt okunur.
 */
export function FilterBuilder({ open, cube, measure, dimensions, initial, seedField, onApply, onClose }: Props) {
  const [group, setGroup] = useState<FilterGroup>({ combinator: "and", rules: [] });
  useEffect(() => {
    if (!open) return;
    const g = fromQueryFilter(initial);
    if (seedField && isEditableFlat(g) && g.rules.length < MAX_FILTER_RULES) g.rules.push({ field: seedField, operator: defaultOp(opsOf(dimensions, seedField)), value: [] });
    setGroup(g.rules.length ? g : { combinator: "and", rules: [{ field: "", operator: "in", value: [] }] });
    // Kurucu her AÇILIŞTA bölümün süzgecinden kurulur; açıkken dış yeniden çizim taslağı silmesin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const flat = isEditableFlat(group);
  const rules = group.rules as FilterRule[];
  const labelOf = useValueLabels(cube.kimlik, measure, flat ? rules.map((r) => r.field).filter(Boolean) : []);
  const sentence = describeFilter(toQueryFilter(group), { field: (id) => cube.boyutlar.find((d) => d.kimlik === id)?.ad ?? id, value: labelOf });
  const setRule = (i: number, p: Partial<FilterRule>) => setGroup((g) => ({ ...g, rules: g.rules.map((r, j) => (j === i ? { ...(r as FilterRule), ...p } : r)) }));
  const incomplete = flat && rules.some((r) => r.field) && toQueryFilter(group)?.rules.length !== rules.filter((r) => r.field).length;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Süzgeç kur</DialogTitle>
          <DialogDescription>Bölüm yalnız koşullara uyan kayıtları sayar. Koşullar “ve” ile bağlanır; kesin denetimi sunucu yapar.</DialogDescription>
        </DialogHeader>
        {flat ? (
          <div className="flex flex-col gap-2" data-testid="suzgec-satirlari">
            {rules.map((r, i) => (
              <FilterRowEditor
                key={i}
                rule={r}
                index={i}
                combinator={group.combinator}
                cube={cube}
                measure={measure}
                dimensions={dimensions}
                labelOf={labelOf}
                onPatch={(p) => setRule(i, p)}
                onToggleJoin={() => setGroup((g) => ({ ...g, combinator: g.combinator === "and" ? "or" : "and" }))}
                onRemove={() => setGroup((g) => ({ ...g, rules: g.rules.filter((_, j) => j !== i) }))}
              />
            ))}
            <Button type="button" size="sm" variant="ghost" className="self-start" disabled={rules.length >= MAX_FILTER_RULES} onClick={() => setGroup((g) => ({ ...g, rules: [...g.rules, { field: "", operator: "in", value: [] }] }))}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Koşul ekle
            </Button>
          </div>
        ) : (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">Bu süzgeç kod modunda gruplu yazılmış; burada yalnız görüntülenir ya da tümden kaldırılır.</p>
        )}
        <div className="rounded border bg-muted/40 px-3 py-2 text-sm" aria-live="polite">
          {sentence ? <span>Süzgeç: {sentence}</span> : <span className="text-muted-foreground">Süzgeç yok — bölüm tüm kayıtları sayar.</span>}
          {incomplete ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Değeri seçilmemiş koşullar kaydedilmez.</span> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" onClick={() => { onApply(undefined); onClose(); }}>Süzgeci kaldır</Button>
          <Button onClick={() => { onApply(flat ? toQueryFilter(group) : fromQueryFilter(initial)); onClose(); }}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
