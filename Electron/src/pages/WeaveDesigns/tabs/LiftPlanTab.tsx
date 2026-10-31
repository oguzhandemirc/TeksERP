// Armür sekmesi: hücre tıkla-boya ızgarası (satır = atkı, sütun = çerçeve; dolu = çerçeve kalkar).
// Boyut çerçeve × atkı girişinden; mevcut hücreler korunur. Asıl doğrulama sunucuda (LIFT_PLAN_INVALID).
import { useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS, liftPlanForSave, liftPlanSize, resizeLiftPlan, toggleLiftCell } from "../lift-plan";
import { weaveDesignApi } from "../service";
import type { LiftPlan, WeaveDesign } from "../types";

export function LiftPlanTab({ design, canWrite }: { design: WeaveDesign; canWrite: boolean }) {
  const qc = useQueryClient();
  const initial = design.liftPlan ?? [];
  const [plan, setPlan] = useState<LiftPlan>(initial);
  const size = liftPlanSize(plan);
  const [frames, setFrames] = useState(String(size.frames || design.frameCount || ""));
  const [picks, setPicks] = useState(String(size.picks || ""));
  const dirty = JSON.stringify(plan) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () => weaveDesignApi.update(design.id, { liftPlan: liftPlanForSave(plan) }),
    onSuccess: () => {
      toast.success("Armür planı kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  const onCell = (e: MouseEvent<HTMLDivElement>) => {
    if (!canWrite) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!el) return;
    setPlan((p) => toggleLiftCell(p, Number(el.dataset.pick), Number(el.dataset.frame)));
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tezgâh desen dosyası: {design.loomFileName ?? "—"} · Satır = atkı, sütun = çerçeve; dolu hücre çerçevenin kalktığını gösterir.
      </p>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lp-frames">Çerçeve (en çok {LIFT_PLAN_MAX_FRAMES})</Label>
            <Input id="lp-frames" className="w-28" inputMode="numeric" value={frames} onChange={(e) => setFrames(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-picks">Atkı (en çok {LIFT_PLAN_MAX_PICKS})</Label>
            <Input id="lp-picks" className="w-28" inputMode="numeric" value={picks} onChange={(e) => setPicks(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setPlan((p) => resizeLiftPlan(p, Number(picks), Number(frames)))}>Boyutu uygula</Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </div>
      )}
      {plan.length === 0 ? (
        <p className="text-sm text-muted-foreground">Armür planı girilmemiş.</p>
      ) : (
        <div className="overflow-auto rounded-md border p-2" onClick={onCell} role="grid" aria-label="Armür ızgarası">
          {plan.map((row, r) => (
            <div key={r} className="flex" role="row">
              <span className="w-10 shrink-0 pr-1 text-right text-[10px] tabular-nums text-muted-foreground">{r + 1}</span>
              {row.map((v, c) => (
                <div key={c} role="gridcell" aria-selected={v === 1} data-pick={r} data-frame={c}
                  className={cn("h-4 w-4 shrink-0 border border-border/60", v === 1 ? "bg-foreground" : "bg-background", canWrite && "cursor-pointer")} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
