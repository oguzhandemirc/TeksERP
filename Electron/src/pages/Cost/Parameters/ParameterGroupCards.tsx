// Parametreler gruplu kartlarda (geniş form felsefesi): değer adın ve biriminin hemen yanında; taslak varsa
// yürürlükteki değerin yanında düzenlenebilir kutu, farklı alan amber vurgulu. Atkı ücreti Dokuma kartının satırıdır.
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { COST_CURRENCIES } from "../shared/CurrencySelect";
import { fmtDecFull, toDecimalText } from "../shared/format";
import type { PickPair } from "../shared/loom-pick";
import { PARAM_FIELDS, paramDiffers, type ParamKey } from "./param-fields";
import type { CostParameterSet } from "./service";

export type ParamForm = Record<ParamKey, string>;

interface Props {
  active: CostParameterSet | null;
  /** Taslak değerleri: null → taslak sütunu çizilmez. */
  form: ParamForm | null;
  draftLabel: string;
  editable: boolean;
  onChange: (key: ParamKey, value: string) => void;
  /** Atkı ücreti satırı (yalnız atkı ücreti yönteminde). */
  pick?: { draft: PickPair | null; onChange: (p: PickPair) => void } | null;
}

const GROUPS = [...new Set(PARAM_FIELDS.map((f) => f.group))];
const NO_CURRENCY = "NONE";

export function ParameterGroupCards({ active, form, draftLabel, editable, onChange, pick }: Props) {
  const cols = form ? "grid-cols-[minmax(10rem,15rem)_8rem_minmax(9rem,14rem)]" : "grid-cols-[minmax(10rem,15rem)_auto]";
  return (
    <div className="grid gap-4 xl:grid-cols-2" data-testid="parameter-groups">
      {GROUPS.map((g) => (
        <section key={g} className="rounded-xl border bg-card p-4 shadow-soft" aria-label={g}>
          <h2 className="mb-2 text-sm font-semibold">{g}</h2>
          <div className={cn("grid items-center gap-x-4 text-sm", cols)}>
            {form && (
              <>
                <span />
                <span className="pb-1 text-xs text-muted-foreground">{active ? `Yürürlükte (v${active.versionNo})` : "Yürürlükte"}</span>
                <span className="pb-1 text-xs text-muted-foreground">{draftLabel}</span>
              </>
            )}
            {PARAM_FIELDS.filter((f) => f.group === g).map((f) => {
              const draftVal = form ? toDecimalText(form[f.key]) : null;
              const changed = !!form && !!active && paramDiffers(active[f.key], draftVal);
              return (
                <Row key={f.key} changed={changed} label={<>{f.label}{form && editable && f.required && <span className="text-destructive" aria-hidden> *</span>}</>}
                  current={<Value text={active ? fmtDecFull(active[f.key], 4) : "—"} unit={f.unit} />}
                  draft={form && (editable ? (
                    <span className="flex items-center gap-2">
                      <Input aria-label={`${f.label} (${f.unit})`} inputMode="decimal"
                        className={cn("h-8 w-24 text-right tabular-nums", changed && "border-amber-500")}
                        value={form[f.key]} onChange={(e) => onChange(f.key, e.target.value)} />
                      <span className="text-xs text-muted-foreground">{f.unit}</span>
                    </span>
                  ) : <Value text={form[f.key] || "—"} unit={f.unit} />)} />
              );
            })}
            {g === "Dokuma" && pick && <PickRow active={active} draft={form ? pick.draft : null} editable={editable} onChange={pick.onChange} />}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ label, current, draft, changed, testId }: { label: ReactNode; current: ReactNode; draft: ReactNode; changed: boolean; testId?: string }) {
  // display:contents → satır ızgaranın sütunlarına oturur; vurgu hücrelerde.
  const cell = cn("py-1.5", changed && "bg-amber-500/10");
  return (
    <div className="contents" data-changed={changed || undefined} data-testid={testId}>
      <span className={cn(cell, "-ml-2 rounded-l-md pl-2")}>{label}</span>
      <span className={cn(cell, !draft && "-mr-2 rounded-r-md pr-2")}>{current}</span>
      {draft && <span className={cn(cell, "-mr-2 rounded-r-md pr-2")}>{draft}</span>}
    </div>
  );
}

function Value({ text, unit }: { text: string; unit?: string }) {
  return (
    <span className="tabular-nums">
      <span className="font-medium">{text}</span>
      {unit && text !== "—" && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
    </span>
  );
}

function PickRow({ active, draft, editable, onChange }: { active: CostParameterSet | null; draft: PickPair | null; editable: boolean; onChange: (p: PickPair) => void }) {
  const activeText = active?.defaultLoomPickRate != null && active.defaultLoomPickCurrency
    ? `${fmtDecFull(active.defaultLoomPickRate, 4)} ${active.defaultLoomPickCurrency}` : "—";
  const changed = !!draft && !!active && (paramDiffers(active.defaultLoomPickRate, toDecimalText(draft.rate))
    || (active.defaultLoomPickCurrency ?? "") !== draft.currency);
  const label = (
    <span className="inline-flex items-center gap-1">
      Atkı ücreti
      <InfoPopover label="Atkı ücreti" desc="1 atkı/cm sıklık için metre başına ücret (ör. 0,02 USD). Dokuma maliyeti &quot;atkı ücreti&quot; yöntemindeyken ürün yapısında ücret yoksa bu kullanılır. Ücret ve döviz birlikte girilir ya da birlikte boş bırakılır." />
    </span>
  );
  const draftCell = draft && (editable ? (
    <span className="flex items-center gap-2">
      <Input aria-label="Varsayılan atkı ücreti" inputMode="decimal" placeholder="boş"
        className={cn("h-8 w-24 text-right tabular-nums", changed && "border-amber-500")}
        value={draft.rate} onChange={(e) => onChange({ ...draft, rate: e.target.value })} />
      <Select value={draft.currency || NO_CURRENCY} onValueChange={(v) => onChange({ ...draft, currency: (v === NO_CURRENCY ? "" : v) as PickPair["currency"] })}>
        <SelectTrigger aria-label="Atkı ücreti dövizi" className="h-8 w-20"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CURRENCY}>—</SelectItem>
          {COST_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
    </span>
  ) : <span className="tabular-nums"><span className="sr-only">Taslak: </span>{draft.rate ? `${draft.rate} ${draft.currency}` : "—"}</span>);
  return <Row testId="pick-rate-row" changed={changed} label={label} current={<Value text={activeText} unit={activeText === "—" ? undefined : "/m"} />} draft={draftCell} />;
}
