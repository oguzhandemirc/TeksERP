// Yürürlükteki set ↔ taslak yan yana; farklı alan amber vurgulu. Taslak sütunu düzenlenebilir (izin varsa).
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtDecFull, toDecimalText } from "../shared/format";
import { PARAM_FIELDS, paramDiffers, type ParamKey } from "./param-fields";
import type { CostParameterSet } from "./service";

export type ParamForm = Record<ParamKey, string>;

interface Props {
  active: CostParameterSet | null;
  /** Taslak sütunu: null → sütun çizilmez. */
  form: ParamForm | null;
  draftLabel: string;
  editable: boolean;
  onChange: (key: ParamKey, value: string) => void;
}

const GROUPS = [...new Set(PARAM_FIELDS.map((f) => f.group))];

export function ParameterCompareTable({ active, form, draftLabel, editable, onChange }: Props) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[32rem] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Alan</th>
            <th className="px-3 py-2">Birim</th>
            <th className="px-3 py-2 text-right">{active ? `Yürürlükteki (v${active.versionNo})` : "Yürürlükteki"}</th>
            {form && <th className="px-3 py-2 text-right">{draftLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {GROUPS.map((g) => (
            <GroupRows key={g} group={g} active={active} form={form} editable={editable} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ group, active, form, editable, onChange }: Omit<Props, "draftLabel"> & { group: string }) {
  return (
    <>
      <tr className="border-t bg-muted/20">
        <td colSpan={form ? 4 : 3} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">{group}</td>
      </tr>
      {PARAM_FIELDS.filter((f) => f.group === group).map((f) => {
        const draftVal = form ? toDecimalText(form[f.key]) : null;
        const changed = !!form && !!active && paramDiffers(active[f.key], draftVal);
        return (
          <tr key={f.key} className={cn("border-t", changed && "bg-amber-500/10")} data-changed={changed || undefined}>
            <td className="px-3 py-1.5">
              {f.label}
              {f.required && <span className="text-destructive" aria-hidden> *</span>}
            </td>
            <td className="px-3 py-1.5 text-muted-foreground">{f.unit}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{active ? fmtDecFull(active[f.key], 4) : "—"}</td>
            {form && (
              <td className="px-3 py-1 text-right">
                {editable ? (
                  <Input
                    aria-label={`${f.label} (${f.unit})`}
                    inputMode="decimal"
                    className={cn("ml-auto h-8 w-full max-w-[9rem] text-right tabular-nums", changed && "border-amber-500")}
                    value={form[f.key]}
                    onChange={(e) => onChange(f.key, e.target.value)}
                  />
                ) : (
                  <span className="tabular-nums">{form[f.key] || "—"}</span>
                )}
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}
