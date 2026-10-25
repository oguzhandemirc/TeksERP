// Kural seti listesi: fabrika varsayılanı üstte, müşteri spesifikasyonları altta. Satır kart olarak
// dizilir (dar ekranda taşmaz); bant özeti "A ≤ 5 · B ≤ 20 · C" biçiminde.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { UNIT_LABEL } from "./ruleSetForm";
import type { RuleSet } from "./service";

const num = (v: string | number) => String(v).replace(".", ",");
export const bandSummary = (s: RuleSet) =>
  s.bands.map((b) => (b.maxScore === null || b.maxScore === "" ? `${b.label} > ${num(s.bands[s.bands.length - 2]?.maxScore ?? 0)}` : `${b.label} ≤ ${num(b.maxScore)}`)).join(" · ");

interface Props { title: string; hint: string; empty: string; sets: RuleSet[]; onEdit: (s: RuleSet) => void; onToggle: (s: RuleSet) => void }

export function RuleSetSection({ title, hint, empty, sets, onEdit, onToggle }: Props) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {sets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {sets.map((s) => (
            <li key={s.id} data-testid="rule-set-row" className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${s.isActive ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1 basis-60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.isActive ? <Badge variant="outline">Etkin</Badge> : <Badge variant="secondary">Pasif</Badge>}
                </div>
                {s.scope === "CUSTOMER" && (
                  <p className="truncate text-sm text-muted-foreground">{s.customer?.name ?? "—"} · {s.item ? s.item.name : "tüm ürünler"}</p>
                )}
              </div>
              <div className="min-w-0 flex-1 basis-60 text-sm">
                <p className="tabular-nums">{bandSummary(s)}</p>
                <p className="text-xs text-muted-foreground">{UNIT_LABEL[s.unit]}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onEdit(s)}>{s.isActive ? "Düzenle" : "Görüntüle"}</Button>
                <PermissionGate permission="inspection:rules">
                  <Button size="sm" variant="ghost" onClick={() => onToggle(s)}>{s.isActive ? "Pasife al" : "Etkinleştir"}</Button>
                </PermissionGate>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
