// Armür sekmesi: hücre tıkla-boya ızgarası (satır = atkı, sütun = çerçeve; dolu = çerçeve kalkar).
// Çerçeve başlığına tıklamak döner (leno) çerçeve işaretini çevirir; sağdaki salt-okunur blok seçili
// kumaşın atkı seçicisidir (sunucu `sequenceCode`tan açar). Asıl doğrulama sunucuda (LIFT_PLAN_INVALID).
import { useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS, lenoWithin, liftPlanForSave, liftPlanSize, resizeLiftPlan, toggleLenoFrame, toggleLiftCell,
} from "../lift-plan";
import { constructionApi, weaveDesignApi } from "../service";
import { LiftPlanGrid } from "./LiftPlanGrid";
import type { DesignFabric, LiftPlan, WeaveDesign } from "../types";

const LEGEND = "Çerçeve numarasına tıklayınca o çerçeve döner (leno) diye işaretlenir; ızgarada ve basılan desen kartında ayrı blok olur. "
  + "Sağdaki 1., 2., 3. sütunları seçili kumaşın atkı kartındaki sıra kodundan gelir (hangi atkıda hangi iplik atılır); "
  + "değiştirmek için Atkı sırası sekmesindeki kodu düzenleyin.";

export function LiftPlanTab({ design, fabric, canWrite }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const initial = design.liftPlan ?? [];
  const initialLeno = design.lenoFrames ?? [];
  const [plan, setPlan] = useState<LiftPlan>(initial);
  const [leno, setLeno] = useState<number[]>(initialLeno);
  const size = liftPlanSize(plan);
  const [frames, setFrames] = useState(String(size.frames || design.frameCount || ""));
  const [picks, setPicks] = useState(String(size.picks || ""));
  const construction = useQuery({
    queryKey: ["item-construction", fabric?.id ?? null, null],
    queryFn: () => constructionApi.get(fabric!.id),
    enabled: !!fabric,
  });
  const weft = construction.data?.weft ?? null;
  const selector = weft?.pickSequence ?? null;
  const selCount = selector ? weft!.yarns.length : 0;
  const rows = Math.max(plan.length, selector?.length ?? 0);
  const lenoSet = new Set(lenoWithin(leno, size.frames));
  const dirty = JSON.stringify(plan) !== JSON.stringify(initial) || JSON.stringify(leno) !== JSON.stringify(initialLeno);
  const save = useMutation({
    mutationFn: () => weaveDesignApi.update(design.id, { liftPlan: liftPlanForSave(plan), lenoFrames: lenoWithin(leno, liftPlanSize(plan).frames) }),
    onSuccess: () => {
      toast.success("Armür planı kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  const onCell = (e: MouseEvent<HTMLDivElement>) => {
    if (!canWrite) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pick],[data-leno]");
    if (!el) return;
    if (el.dataset.leno) setLeno((l) => toggleLenoFrame(l, Number(el.dataset.leno)));
    else setPlan((p) => toggleLiftCell(p, Number(el.dataset.pick), Number(el.dataset.frame)));
  };
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        Tezgâh desen dosyası: {design.loomFileName ?? "—"} · Satır = atkı, sütun = çerçeve; dolu hücre çerçevenin kalktığını gösterir.
        <InfoPopover label="Döner çerçeve ve atkı seçici" desc={LEGEND} />
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
      {rows === 0 ? (
        <p className="text-sm text-muted-foreground">Armür planı girilmemiş.</p>
      ) : (
        <LiftPlanGrid plan={plan} frames={size.frames} rows={rows} leno={lenoSet} selector={selector} selCount={selCount} canWrite={canWrite} onClick={onCell} />
      )}
      {weft && (
        <p className="text-xs text-muted-foreground">
          {selector
            ? `Atkı seçici: ${weft.code} · ${weft.yarns.map((y) => `${y.sortOrder + 1}. ${y.yarnItem.name}`).join(" · ")}`
            : `${weft.code} atkı kartında sıra kodu yok — seçici sütunu için Atkı sırası sekmesinde kodu girin (ör. A4 B1 A4 C1).`}
        </p>
      )}
    </div>
  );
}
