// ③ Kademe kuralları — kademede kural yoksa örtük kural (holün vardiya sorumlusu) çalışır.
import { useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DUTY_TIERS, RULE_KIND_LABEL, ruleTarget, tierRulesSummary, type PersonOption } from "./duty-model";
import { RuleFormDialog } from "./RuleFormDialog";
import type { DutyPermissionOption, DutyRule, RuleBody } from "./types";

interface Props {
  rules: readonly DutyRule[];
  people: readonly PersonOption[];
  permissions: readonly DutyPermissionOption[];
  busy: boolean;
  onAdd: (body: RuleBody) => Promise<boolean>;
  onRevoke: (r: DutyRule) => void;
}

export function RulesSection({ rules, people, permissions, busy, onAdd, onRevoke }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">Kademe kuralları</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Kural
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {DUTY_TIERS.map((t) => (
          <div key={t}>
            <h4 className="mb-1 text-xs font-semibold">Kademe {t}</h4>
            {tierRulesSummary(rules, t) && <p className="text-sm text-muted-foreground">{tierRulesSummary(rules, t)}</p>}
            <ul>
              {rules.filter((r) => r.tier === t).map((r) => (
                <li key={r.id} className="flex items-center gap-2 border-b py-1.5 text-sm last:border-0">
                  <span className="text-muted-foreground">{RULE_KIND_LABEL[r.kind]}:</span>
                  {r.user && !r.user.canViewAlarms && <AlertTriangle className="h-3 w-3 text-amber-600" aria-label="Alarmları göremez" />}
                  <span className="font-medium">{ruleTarget(r)}</span>
                  <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" disabled={busy} onClick={() => onRevoke(r)} aria-label="Kuralı kaldır">
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {formOpen && <RuleFormDialog onOpenChange={setFormOpen} people={people} permissions={permissions} busy={busy} onSubmit={onAdd} />}
    </section>
  );
}
