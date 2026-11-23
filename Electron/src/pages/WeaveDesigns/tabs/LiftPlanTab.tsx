// Armür sekmesi = armür EDİTÖRÜ (satır = atkı, sütun = çerçeve; dolu = çerçeve kalkar): sürükle-boya, seçim,
// geri al, hazır örgü, atkı/çerçeve ekle-sil (`lift-editor-reducer`). Çerçeve başlığına tıklamak döner (leno)
// işaretini çevirir; sağdaki salt-okunur blok seçili kumaşın atkı seçicisidir (sunucu açar). Kumaş görünümü
// taslaktan canlı çizilir; kaydedilen değer liftPlan/lenoFrames, asıl doğrulama sunucuda (LIFT_PLAN_INVALID).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatQty } from "@/lib/format";
import { LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS, liftPlanForSave } from "../lift-plan";
import { constructionApi, weaveDesignApi } from "../service";
import { LiftPlanGrid } from "./LiftPlanGrid";
import { LiftPlanToolbar } from "./LiftPlanToolbar";
import { FabricPreviewSection } from "./FabricPreviewSection";
import { useLiftPlanEditor } from "./useLiftPlanEditor";
import type { EditorAction, EditorState } from "./lift-editor-reducer";
import { useWeaveDirection } from "@/components/weave/weave-direction";
import { WeaveDirectionToggle } from "@/components/weave/WeaveViewControls";
import type { DesignFabric, EffectiveConstruction, LiftPlan, WeaveDesign } from "../types";

const LEGEND = "Çerçeve numarasına tıklayınca o çerçeve döner (leno) diye işaretlenir; ızgarada ve basılan desen kartında ayrı blok olur. "
  + "Sağdaki 1., 2., 3. sütunları seçili kumaşın atkı kartındaki sıra kodundan gelir (hangi atkıda hangi iplik atılır); "
  + "değiştirmek için Atkı sırası sekmesindeki kodu düzenleyin.";

const EMPTY: number[] = [];

export function LiftPlanTab({ design, fabric, canWrite }: { design: WeaveDesign; fabric: DesignFabric | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const initial = useMemo<LiftPlan>(() => design.liftPlan ?? [], [design.liftPlan]);
  const initialLeno = design.lenoFrames ?? EMPTY;
  const [direction, setDirection] = useWeaveDirection();
  const ed = useLiftPlanEditor(initial, initialLeno, direction);
  const { state, dispatch, plan, size, lenoList, lenoSet, dirty } = ed;
  const construction = useQuery({
    queryKey: ["item-construction", fabric?.id ?? null, null],
    queryFn: () => constructionApi.get(fabric!.id),
    enabled: !!fabric,
  });
  const weft = construction.data?.weft ?? null;
  const selector = weft?.pickSequence ?? null;
  const selCount = selector ? weft!.yarns.length : 0;
  const rows = Math.max(plan.length, selector?.length ?? 0);
  const save = useMutation({
    mutationFn: () => weaveDesignApi.update(design.id, { liftPlan: liftPlanForSave(plan), lenoFrames: lenoList }),
    onSuccess: () => {
      toast.success("Armür planı kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["weave-designs"] });
    },
  });
  return (
    <div className="space-y-4" onKeyDown={canWrite ? ed.onKeyDown : undefined}>
      <p className="flex items-center gap-1 text-sm text-muted-foreground">
        Tezgâh desen dosyası: {design.loomFileName ?? "—"} · Satır = atkı, sütun = çerçeve; dolu hücre çerçevenin kalktığını gösterir.
        <InfoPopover label="Döner çerçeve ve atkı seçici" desc={LEGEND} />
      </p>
      {canWrite && (
        <>
          <SaveBar key={`${size.picks}x${size.frames}`} size={size} dirty={dirty} saving={save.isPending} dispatch={dispatch}
            onSave={() => save.mutate()} onRevert={() => dispatch({ type: "load", snap: { plan: initial, leno: initialLeno } })} />
          {size.picks > 0 && (
            <LiftPlanToolbar dispatch={dispatch} tool={state.tool} canUndo={state.hist.past.length > 0} canRedo={state.hist.future.length > 0}
              hasSel={!!state.sel} hasClip={!!state.clip} direction={direction} />
          )}
        </>
      )}
      {rows === 0 ? (
        <p className="text-sm text-muted-foreground">Armür planı girilmemiş{canWrite ? " — çerçeve ve atkı sayısını yazıp “Izgarayı kur”a basın." : "."}</p>
      ) : (
        // Desen kâğıdı düzeni: solda armür + seçici, sağda tahar + kumaş görünümü (dar pencerede alt alta).
        <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
          <section className="min-w-0 max-w-full space-y-2" aria-label="Armür planı">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Armür planı{selCount > 0 ? " ve atkı seçici" : ""}</h3>
              <WeaveDirectionToggle value={direction} onChange={setDirection} />
            </div>
            <LiftPlanGrid plan={plan} frames={size.frames} rows={rows} leno={lenoSet} selector={selector} selCount={selCount} canWrite={canWrite}
              direction={direction} selection={state.sel} cursor={state.cursor}
              onCellDown={(cell, select) => dispatch({ type: "down", cell, select })} onCellEnter={(cell) => dispatch({ type: "enter", cell })}
              onStrokeEnd={() => dispatch({ type: "up" })} onLenoToggle={(frame) => dispatch({ type: "toggleLeno", frame })} />
            {canWrite && size.picks > 0 && <EditorStatus state={state} />}
            {weft && <SelectorNote weft={weft} hasSelector={!!selector} />}
          </section>
          {size.picks > 0 && (
            <FabricPreviewSection design={design} plan={plan} lenoFrames={lenoList} selector={selector}
              yarnNames={weft?.yarns.map((y) => y.yarnItem.name) ?? []} direction={direction} />
          )}
        </div>
      )}
      {rows === 0 && weft && <SelectorNote weft={weft} hasSelector={!!selector} />}
    </div>
  );
}

function SaveBar({ size, dirty, saving, dispatch, onSave, onRevert }: {
  size: { picks: number; frames: number }; dirty: boolean; saving: boolean; dispatch: (a: EditorAction) => void; onSave: () => void; onRevert: () => void;
}) {
  const [frames, setFrames] = useState(String(size.frames || ""));
  const [picks, setPicks] = useState(String(size.picks || ""));
  const empty = size.picks === 0;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="lp-frames">Çerçeve (en çok {LIFT_PLAN_MAX_FRAMES})</Label>
        <Input id="lp-frames" className="w-28" inputMode="numeric" value={frames} onChange={(e) => setFrames(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lp-picks">Atkı (en çok {LIFT_PLAN_MAX_PICKS})</Label>
        <Input id="lp-picks" className="w-28" inputMode="numeric" value={picks} onChange={(e) => setPicks(e.target.value)} />
      </div>
      <Button variant="outline" size="sm" onClick={() => dispatch({ type: "resize", picks: Number(picks), frames: Number(frames) })}>
        {empty ? "Izgarayı kur" : "Boyutu uygula"}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        {dirty && <span className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status">Kaydedilmemiş değişiklik var</span>}
        <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={onRevert}>Vazgeç</Button>
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>Kaydet</Button>
      </div>
    </div>
  );
}

function EditorStatus({ state }: { state: EditorState }) {
  const { cursor, sel } = state;
  const v = state.hist.present.plan[cursor.r]?.[cursor.c];
  return (
    <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
      İmleç: atkı {formatQty(cursor.r + 1, 0)} · çerçeve {formatQty(cursor.c + 1, 0)} ({v === 1 ? "kalkık" : "inik"})
      {sel && ` · seçim ${formatQty(sel.r1 - sel.r0 + 1, 0)} atkı × ${formatQty(sel.c1 - sel.c0 + 1, 0)} çerçeve`}
      {state.clip && ` · panoda ${formatQty(state.clip.length, 0)}×${formatQty(state.clip[0]?.length ?? 0, 0)}`}
    </p>
  );
}

function SelectorNote({ weft, hasSelector }: { weft: NonNullable<EffectiveConstruction["weft"]>; hasSelector: boolean }) {
  return (
    <p className="max-w-md text-xs text-muted-foreground">
      {hasSelector
        ? `Atkı seçici: ${weft.code} · ${weft.yarns.map((y) => `${y.sortOrder + 1}. ${y.yarnItem.name}`).join(" · ")}`
        : `${weft.code} atkı kartında sıra kodu yok — seçici sütunu için Atkı sırası sekmesinde kodu girin (ör. A4 B1 A4 C1).`}
    </p>
  );
}
