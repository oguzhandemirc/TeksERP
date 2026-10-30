// GELEN BELGEDEN İŞ EMRİ (D4-D2) — onaylı belgenin topları desen gruplarına ayrılır; seçili her grup için MEVCUT
// hızlı iş emri ucu (`quick-start`) grup başına token ve hedef değerle çağrılır. Rota şablonunu kullanıcı seçer.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { ProcessValueSearchDialog } from "./ProcessValueSearchDialog";
import { WorkOrderPlanGroupCard } from "./WorkOrderPlanGroupCard";
import { useWorkOrderPlan } from "./useWorkOrderPlan";
import type { ChoiceProperty } from "./types";
import { TERIM } from "@/lib/terim";

interface Props {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkOrderFromNoteDialog({ noteId, open, onOpenChange }: Props) {
  const s = useWorkOrderPlan(noteId, open);
  const [picking, setPicking] = useState<{ key: string; property: ChoiceProperty } | null>(null);
  const p = s.plan.data;
  const busy = s.start.isPending;
  const meters = s.selected.reduce((t, g) => t + g.rolls.filter((r) => r.attachable).reduce((a, r) => a + Number(r.meters), 0), 0);
  const blocking = !s.routeId ? "Bir rota şablonu seçin." : s.hasTambur && !s.foldType ? "Kat tipi seçin." : s.selected.length === 0 ? "En az bir grup seçin." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="wo-from-note">
        <DialogHeader>
          <DialogTitle>Belgeden {TERIM.terbiyeIsEmri.tekilKucuk} aç{p ? ` — ${p.noteNo}` : ""}</DialogTitle>
          <DialogDescription>
            Toplar desene göre gruplandı; her seçili grup için ayrı {TERIM.terbiyeIsEmri.tekilKucuk} açılır ve desen {TERIM.terbiyeIsEmri.cekimKucuk.ilgi} hedefi olur.
          </DialogDescription>
        </DialogHeader>
        {s.plan.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {s.plan.isError && <p className="text-sm text-destructive">Plan yüklenemedi.</p>}
        {p && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="text-muted-foreground">Sahip: </span>
                {p.owner?.name ?? "—"}
              </span>
              <span data-testid="plan-customer-batch">
                <span className="text-muted-foreground">Müşteri partisi: </span>
                {p.customerBatch?.batchNo ?? "yok"}
              </span>
            </div>
            <PlanRouteFields s={s} suggestedRouteTemplateId={p.suggestedRouteTemplateId} busy={busy} />
            {s.route && <p className="text-[11px] text-muted-foreground">{s.route.steps?.map((st) => st.station?.name ?? "—").join(" → ")}</p>}
            {p.groups.length === 0 && <p className="text-sm text-muted-foreground">Bu belgeden doğmuş top yok.</p>}
            {p.groups.map((g) => (
              <WorkOrderPlanGroupCard
                key={g.key}
                group={g}
                targets={s.targetsOf(g.key)}
                properties={p.choiceProperties}
                checked={!!s.checked[g.key]}
                disabled={busy}
                doneNumber={s.done[g.key] ?? null}
                onCheckedChange={(v) => s.setChecked((c) => ({ ...c, [g.key]: v }))}
                onPickValue={(property) => setPicking({ key: g.key, property })}
                onClearValue={(propertyId) => {
                  const prop = p.choiceProperties.find((x) => x.propertyId === propertyId);
                  if (prop) s.setValue(g.key, prop, null);
                }}
              />
            ))}
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          {blocking && p && <span className="text-xs text-muted-foreground sm:mr-auto">{blocking}</span>}
          {!blocking && (
            <span className="text-xs text-muted-foreground sm:mr-auto" data-testid="plan-summary">
              {s.selected.length} {TERIM.terbiyeIsEmri.tekilKucuk} · {formatNumber(meters, 1)} m
            </span>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Kapat
          </Button>
          <Button onClick={() => s.start.mutate()} disabled={!!blocking || busy || !p}>
            {busy ? "Açılıyor…" : `${s.selected.length} ${TERIM.terbiyeIsEmri.tekilKucuk} aç`}
          </Button>
        </DialogFooter>
      </DialogContent>
      {picking && (
        <ProcessValueSearchDialog
          open
          onOpenChange={(o) => !o && setPicking(null)}
          propertyId={picking.property.propertyId}
          propertyName={picking.property.propertyName}
          selectedId={s.targetsOf(picking.key).find((t) => t.propertyId === picking.property.propertyId)?.valueId ?? null}
          onSelect={(v) => s.setValue(picking.key, picking.property, v)}
        />
      )}
    </Dialog>
  );
}

/** Rota şablonu + (tamburlu rotada) kat tipi seçimi — ReworkRollsDialog emsali yerel seçim. */
function PlanRouteFields({ s, suggestedRouteTemplateId, busy }: { s: ReturnType<typeof useWorkOrderPlan>; suggestedRouteTemplateId: string | null; busy: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2 sm:gap-3">
      <label className="grid gap-1 text-xs text-muted-foreground">
        Rota şablonu{suggestedRouteTemplateId && s.routeId === suggestedRouteTemplateId ? " (bu sahibin son kullandığı)" : ""}
        <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={s.routeId ?? ""} disabled={busy} onChange={(e) => s.setRouteId(e.target.value || null)} aria-label="Rota şablonu">
          <option value="">— Rota seç</option>
          {s.routeList.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {s.hasTambur && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Kat tipi
          <select className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" value={s.foldType ?? ""} disabled={busy} onChange={(e) => s.setFoldType(e.target.value || null)} aria-label="Kat tipi">
            {s.foldValues.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
