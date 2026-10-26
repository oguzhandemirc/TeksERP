import { useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ParamPickerDialog } from "../../ParamPickerDialog";
import type { CatalogCube } from "../custom-api";
import { useDimensionOptions, useValueLabels } from "./dimension-values";
import {
  addGroup,
  addRule,
  countRules,
  describeFilter,
  EMPTY_RULE,
  fromQueryFilter,
  isEditable,
  isGroup,
  isRange,
  isSingleValue,
  leafFields,
  MAX_FILTER_RULES,
  OPERATOR_LABELS,
  patchRuleAt,
  removeRuleAt,
  toggleJoin,
  toQueryFilter,
  type FilterGroup,
  type FilterOperator,
  type FilterRule,
  type RulePath,
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
  /** Satırın solundaki bağlaç: ilk satırda yok; diğerlerinde grubun bağlacı (tıklayınca bütün grup değişir). */
  join: { combinator: FilterGroup["combinator"]; onToggle: () => void } | null;
  cube: CatalogCube;
  measure: string | undefined;
  dimensions: Props["dimensions"];
  labelOf: (dim: string, v: string) => string;
  onPatch: (p: Partial<FilterRule>) => void;
  onRemove: () => void;
}

function JoinButton({ combinator, onToggle }: { combinator: FilterGroup["combinator"]; onToggle: () => void }) {
  return (
    <Button type="button" size="sm" variant="outline" className="h-8 w-12 text-xs" aria-label={`Bağlaç: ${combinator === "or" ? "veya" : "ve"} — değiştir`} onClick={onToggle}>
      {combinator === "or" ? "veya" : "ve"}
    </Button>
  );
}

/** "arasında" değeri: iki sınır düğmesi (her biri tek seçimli modal açar). */
function RangeValue({ values, label, onPick }: { values: string[]; label: (v: string) => string; onPick: (i: 0 | 1) => void }) {
  const edge = (i: 0 | 1, name: string) => (
    <Button type="button" size="sm" variant="outline" className="h-8 max-w-[8rem] truncate text-xs" aria-label={name} onClick={() => onPick(i)}>
      {values[i] ? label(values[i]!) : `${name}…`}
    </Button>
  );
  return (
    <span className="flex items-center gap-1 text-xs" data-testid="suzgec-aralik">
      {edge(0, "Başlangıç")}
      <span className="text-muted-foreground">ile</span>
      {edge(1, "Bitiş")}
      <span className="text-muted-foreground">arası</span>
    </span>
  );
}

/** Tek satır: bağlaç · alan (modal) · işleç (düğmeler) · değer (modal; "içerir"de metin, "arasında"da iki sınır). */
function FilterRowEditor({ rule, join, cube, measure, dimensions, labelOf, onPatch, onRemove }: RowProps) {
  const [picker, setPicker] = useState<"field" | "value" | "from" | "to" | null>(null);
  const options = useDimensionOptions(cube.kimlik, measure, rule.field, picker === "value" || picker === "from" || picker === "to");
  const ops = opsOf(dimensions, rule.field);
  const fieldName = dimensions.find((d) => d.kimlik === rule.field)?.ad;
  const values = asList(rule.value);
  const bound = (i: 0 | 1, v: string | undefined) => {
    const next = [values[0] ?? "", values[1] ?? ""];
    next[i] = v ?? "";
    onPatch({ value: next });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card p-2" data-testid="suzgec-satiri">
      {join ? <JoinButton {...join} /> : <span className="w-12 text-xs text-muted-foreground">Koşul</span>}
      <Button type="button" size="sm" variant="outline" className="h-8 max-w-[12rem] truncate text-xs" onClick={() => setPicker("field")}>
        {fieldName ?? "Alan seç…"}
      </Button>
      <div className="flex flex-wrap gap-1" role="group" aria-label="İşleç">
        {ops.map((op) => (
          <button
            key={op}
            type="button"
            aria-pressed={rule.operator === op}
            onClick={() => onPatch({ operator: op, value: isSingleValue(op) ? (values[0] ?? "") : isRange(op) ? values.slice(0, 2) : values.filter(Boolean) })}
            className={cn("rounded-md border px-2 py-1 text-xs", rule.operator === op ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {OPERATOR_LABELS[op]}
          </button>
        ))}
      </div>
      {rule.field && rule.operator === "contains" ? (
        <Input aria-label="Aranan metin" className="h-8 w-40 text-xs" maxLength={200} value={typeof rule.value === "string" ? rule.value : ""} onChange={(e) => onPatch({ value: e.target.value })} />
      ) : rule.field && isRange(rule.operator) ? (
        <RangeValue values={values} label={(v) => labelOf(rule.field, v)} onPick={(i) => setPicker(i === 0 ? "from" : "to")} />
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
        open={picker === "value" || picker === "from" || picker === "to"}
        title={
          options.isLoading
            ? `${fieldName ?? ""} — değerler yükleniyor…`
            : options.isError
              ? `${fieldName ?? ""} — değer listesi alınamadı`
              : `${fieldName ?? "Değer"}${picker === "from" ? " — başlangıç" : picker === "to" ? " — bitiş" : ""}`
        }
        options={options.data ?? []}
        multiple={picker === "value" && !isSingleValue(rule.operator)}
        allowAll={false}
        selected={picker === "from" ? values.slice(0, 1).filter(Boolean) : picker === "to" ? values.slice(1, 2).filter(Boolean) : values}
        onApply={(v) => (picker === "from" ? bound(0, v[0]) : picker === "to" ? bound(1, v[0]) : onPatch({ value: isSingleValue(rule.operator) ? (v[0] ?? "") : v }))}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

/** İç grup kutusu: dış bağlaç · kesikli çerçeve (parantez) · gruba koşul ekleme. */
function GroupBox({ join, full, onAdd, children }: { join: RowProps["join"]; full: boolean; onAdd: () => void; children: ReactNode }) {
  return (
    <div className="flex items-start gap-1.5" data-testid="suzgec-grubu">
      {join ? <JoinButton {...join} /> : <span className="mt-2 w-12 text-xs text-muted-foreground">Grup</span>}
      <div className="flex flex-1 flex-col gap-1.5 rounded-md border border-dashed border-primary/50 bg-muted/30 p-2" role="group" aria-label="Koşul grubu">
        {children}
        <Button type="button" size="sm" variant="ghost" className="self-start" disabled={full} onClick={onAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Gruba koşul ekle
        </Button>
      </div>
    </div>
  );
}

/**
 * Süzgeç kurucu (SuzgecKurucu): `alan · işleç · değer` satırları → `{combinator, rules}` (plan §3.2).
 * Kök "ve"/"veya" + bir seviye iç grup + "arasında". İstemci SQL kurmaz; JSON sunucuda derlenir.
 * Kod modunda iç içe (iki seviye) yazılmış süzgeç burada salt okunur — sunucu zaten reddeder.
 */
export function FilterBuilder({ open, cube, measure, dimensions, initial, seedField, onApply, onClose }: Props) {
  const [group, setGroup] = useState<FilterGroup>({ combinator: "and", rules: [] });
  useEffect(() => {
    if (!open) return;
    const g = fromQueryFilter(initial);
    if (seedField && isEditable(g) && countRules(g) < MAX_FILTER_RULES) g.rules.push({ field: seedField, operator: defaultOp(opsOf(dimensions, seedField)), value: [] });
    setGroup(g.rules.length ? g : { combinator: "and", rules: [{ ...EMPTY_RULE }] });
    // Kurucu her AÇILIŞTA bölümün süzgecinden kurulur; açıkken dış yeniden çizim taslağı silmesin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const editable = isEditable(group);
  const labelOf = useValueLabels(cube.kimlik, measure, editable ? leafFields(group) : []);
  const built = toQueryFilter(group);
  const sentence = describeFilter(built, { field: (id) => cube.boyutlar.find((d) => d.kimlik === id)?.ad ?? id, value: labelOf });
  const started = leafFields(group).length;
  const incomplete = editable && started > 0 && (built ? countRules(built) : 0) !== started;
  const full = countRules(group) >= MAX_FILTER_RULES;
  const row = (r: FilterRule, path: RulePath, join: RowProps["join"]) => (
    <FilterRowEditor
      key={path.join(".")}
      rule={r}
      join={join}
      cube={cube}
      measure={measure}
      dimensions={dimensions}
      labelOf={labelOf}
      onPatch={(p) => setGroup((g) => patchRuleAt(g, path, p))}
      onRemove={() => setGroup((g) => removeRuleAt(g, path))}
    />
  );
  const rootJoin = (i: number) => (i === 0 ? null : { combinator: group.combinator, onToggle: () => setGroup((g) => toggleJoin(g, null)) });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Süzgeç kur</DialogTitle>
          <DialogDescription>
            Bölüm yalnız koşullara uyan kayıtları sayar. Koşulları “ve” ya da “veya” ile bağlayın (bağlaca tıklayın); grup, içindeki koşulları tek koşul gibi birlikte değerlendirir. Kesin denetimi sunucu yapar.
          </DialogDescription>
        </DialogHeader>
        {editable ? (
          <div className="flex flex-col gap-2" data-testid="suzgec-satirlari">
            {group.rules.map((r, i) =>
              isGroup(r) ? (
                <GroupBox key={i} join={rootJoin(i)} full={full} onAdd={() => setGroup((g) => addRule(g, i))}>
                  {r.rules.map((x, j) => (isGroup(x) ? null : row(x, [i, j], j === 0 ? null : { combinator: r.combinator, onToggle: () => setGroup((g) => toggleJoin(g, i)) })))}
                </GroupBox>
              ) : (
                row(r, [i], rootJoin(i))
              ),
            )}
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={full} onClick={() => setGroup((g) => addRule(g, null))}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Koşul ekle
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={full} onClick={() => setGroup((g) => addGroup(g))}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Grup ekle
              </Button>
              {full ? <span className="self-center text-xs text-muted-foreground">En çok {MAX_FILTER_RULES} koşul.</span> : null}
            </div>
          </div>
        ) : (
          <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">Bu süzgeç kod modunda iç içe gruplu yazılmış; burada yalnız görüntülenir ya da tümden kaldırılır.</p>
        )}
        <div className="rounded border bg-muted/40 px-3 py-2 text-sm" aria-live="polite">
          {sentence ? <span>Süzgeç: {sentence}</span> : <span className="text-muted-foreground">Süzgeç yok — bölüm tüm kayıtları sayar.</span>}
          {incomplete ? <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Değeri seçilmemiş koşullar kaydedilmez.</span> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" onClick={() => { onApply(undefined); onClose(); }}>Süzgeci kaldır</Button>
          <Button onClick={() => { onApply(editable ? built : fromQueryFilter(initial)); onClose(); }}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
