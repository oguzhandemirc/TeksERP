// Armür sekmesi "Kumaş görünümü" bölümü — desen kâğıdı düzeni: üstte tahar şeridi (çerçeve × tel), altında
// kumaş görünümü (drawdown). Düzenlenen (kaydedilmemiş) armürle canlı güncellenir; yalnız görünümdür.
// Döner (LENO) desende çizilmez (karar 2a): çaprazlanan döner teli kare ızgarayla gösterilemez → açıklama.
import { useState } from "react";
import { Callout } from "@/components/ui/callout";
import { InfoPopover } from "@/components/ui/info-popover";
import { WeaveGrid } from "@/components/weave/WeaveGrid";
import { WeaveScrollBox } from "@/components/weave/WeaveScrollBox";
import { WeaveSegmented } from "@/components/weave/WeaveViewControls";
import { YarnLegend } from "@/components/weave/YarnLegend";
import { computeDrawdown, drawdownRepeatPicks, groundFrameIndexes, threadingMatrix } from "@/components/weave/weave-drawdown";
import type { WeaveDirection } from "@/components/weave/weave-direction";
import { WARP_COLOR, LIFT_COLOR, yarnColor, yarnLetter } from "@/components/weave/weave-palette";
import type { LiftPlan, WeaveDesign } from "../types";
import { isLeno } from "../weave-class";

const REPEATS = [1, 2, 4] as const;
const ROW_LABEL_W = 30;

const DRAWDOWN_INFO = "Kumaş görünümü armür planından ve atkı seçiciden çizilir: telin çerçevesi kalkıksa kare çözgü rengini, "
  + "inikse o atkıda atılan ipliğin rengini alır. Tahar planı girilmediği için düz tahar varsayılır (zemin çerçeveleri 1, 2, 3… sırayla; "
  + "döner çerçeveler hariç). Kalın çizgiler desen raporunun sınırıdır.";

const LENO_INFO = "Döner (leno) desende döner teli zemin telinin etrafında çaprazlanır; kare ızgara bu hareketi gösteremez, bu yüzden "
  + "kumaş görünümü çizilmez. Döner çerçeveler yukarıdaki armür ızgarasında turuncu sütunlardır; döner tertibatı tezgâhta ayrıca ayarlanır.";

interface Props {
  design: Pick<WeaveDesign, "kind" | "shedMechanism" | "weaveStructure" | "drawingInNote" | "lenoSetup">;
  plan: LiftPlan;
  lenoFrames: readonly number[];
  selector: number[] | null;
  yarnNames: readonly string[];
  direction: WeaveDirection;
}

export function FabricPreviewSection({ design, plan, lenoFrames, selector, yarnNames, direction }: Props) {
  const [repeat, setRepeat] = useState<number>(2);
  // Döner bir ÖRGÜdür (mekanizma değil): Armür · Döner kartta da kumaş görünümü çizilmez.
  const lenoWeave = isLeno(design);
  const heading = (
    <h3 className="flex items-center gap-1 text-sm font-semibold">
      Kumaş görünümü
      <InfoPopover label="Kumaş görünümü nasıl çizilir" desc={lenoWeave ? LENO_INFO : DRAWDOWN_INFO} />
    </h3>
  );
  if (lenoWeave) {
    return (
      <section className="min-w-0 max-w-xl flex-1 space-y-2" aria-label="Kumaş görünümü">
        {heading}
        <Callout tone="muted" title="Döner desende kumaş görünümü çizilmez">
          Döner teli zemin telinin etrafında çaprazlandığı için kare ızgarayla gösterilemez; döner çerçeveler armür ızgarasında turuncu sütunlardır.
          {design.lenoSetup && <span className="mt-1 block">Döner tertibatı: {design.lenoSetup}</span>}
        </Callout>
      </section>
    );
  }
  const frames = plan.reduce((m, row) => Math.max(m, row.length), 0);
  const ground = groundFrameIndexes(frames, lenoFrames);
  if (plan.length === 0 || ground.length === 0) return null;
  const dd = computeDrawdown({ liftPlan: plan, lenoFrames, pickSequence: selector, repeat });
  const basePicks = drawdownRepeatPicks(plan.length, selector?.length ?? 0);
  const threading = threadingMatrix(frames, dd.draw);
  const leno = new Set(lenoFrames);
  const cell = Math.max(5, Math.min(14, Math.floor(640 / Math.max(1, dd.ends))));
  const usedYarns = [...new Set(dd.cells.flat().filter((v) => v > 0))].sort((a, b) => a - b);
  return (
    <section className="min-w-0 max-w-full space-y-2" aria-label="Kumaş görünümü">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {heading}
        <WeaveSegmented label="Rapor tekrarı" value={repeat} onChange={setRepeat}
          options={REPEATS.map((n) => ({ value: n, label: `${n}×`, title: `${n} rapor yan yana ve üst üste` }))} />
      </div>
      <WeaveScrollBox direction={direction} className="max-h-[70vh] pt-0" label="Tahar ve kumaş görünümü">
        <div className="inline-flex flex-col gap-1">
          {/* Tahar kutu kaysa da üstte kalır: alttan yukarı görünümde kutu açılışta alta kayar. */}
          <div className="sticky top-0 z-10 space-y-1 bg-background pb-2 pt-2">
            <span className="block text-[11px] font-medium text-muted-foreground" style={{ paddingLeft: ROW_LABEL_W }}>Tahar (çerçeve × tel)</span>
            <WeaveGrid ariaLabel="Tahar planı" rows={frames} cols={dd.ends} cell={cell} direction="bottom-up" rowLabelWidth={ROW_LABEL_W}
              rowLabel={(f) => String(f + 1)} colBandEvery={ground.length}
              fill={(f, i) => (threading[f]![i] === 1 ? LIFT_COLOR : null)} />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground" style={{ paddingLeft: ROW_LABEL_W }}>Kumaş (atkı × tel)</span>
          <WeaveGrid ariaLabel="Kumaş görünümü" rows={dd.picks} cols={dd.ends} cell={cell} direction={direction} rowLabelWidth={ROW_LABEL_W}
            rowBandEvery={basePicks} colBandEvery={ground.length} gridLines={cell >= 8}
            fill={(j, i) => { const v = dd.cells[j]![i]!; return v === 0 ? WARP_COLOR : yarnColor(v); }} />
        </div>
      </WeaveScrollBox>
      <p className="max-w-xl text-xs text-muted-foreground">
        {design.drawingInNote ? `Düz tahar varsayıldı · tahar notu: ${design.drawingInNote}` : "Düz tahar varsayıldı (tahar planı girilmemiş)."}
        {leno.size > 0 && " Döner çerçeveler kumaş görünümüne girmez."}
        {!selector && " Atkı seçici yok — tek atkı ipliğiyle çizildi."}
      </p>
      <YarnLegend entries={[
        { color: WARP_COLOR, label: "Çözgü üstte" },
        ...usedYarns.map((n) => ({ color: yarnColor(n), mark: yarnLetter(n - 1), label: `${yarnNames[n - 1] ?? `${n}. atkı ipliği`} üstte` })),
      ]} />
    </section>
  );
}
