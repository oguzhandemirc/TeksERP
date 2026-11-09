// Rehberli tanıtma paneli (belge tanıt 3 aşama): aşama şeridi "① Tanıma · ② Eşleme · ③ Kurallar" + aşama gövdesi + Geri/İleri.
// İleri o aşamanın sorunu yoksa açık, kapalıysa gerekçe tek satır; şeritten geri hep, ileri kapıya uyarak. Durum geçişleri saf `guidedReduce`te.
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EslemeStage, type PreviewInfo } from "./EslemeStage";
import type { GuidedEvent, GuidedState } from "./guidedTeach";
import { KurallarStage } from "./KurallarStage";
import { canReach, confidenceText, stageIndex, stageProblems, STAGES, type StageContext } from "./stages";
import type { ScanWord, SimilarTemplate } from "./types";

interface Props {
  g: GuidedState;
  words: readonly ScanWord[];
  dispatch: (ev: GuidedEvent) => void;
  onName: (name: string) => void;
  /** Kimlik yazısını kapat (fotoğrafta satıra yeniden dokunmakla aynı). */
  onIdentifierOff: (text: string) => void;
  preview: PreviewInfo;
  ctx: StageContext;
  /** ① "Benzeyen tip · Onu düzenle": o tipin düzenle kipine geçer (bu belgeyle). Güncellenen tip listede yoktur. */
  onEditSimilar: (code: string) => void;
  existingCode: string | null;
}

function StageStrip({ g, words, dispatch, ctx }: Pick<Props, "g" | "words" | "dispatch" | "ctx">) {
  const at = stageIndex(g.stage);
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Tanıtma aşamaları">
      {STAGES.map((st, i) => {
        const done = i < at;
        const reachable = canReach(g.stage, st.key, g.teach, { words, ctx });
        return (
          <Button key={st.key} type="button" size="sm" role="tab" aria-selected={i === at} disabled={!reachable} variant={i === at ? "default" : "outline"} className={cn(done && "border-emerald-600 text-emerald-700 dark:text-emerald-300")} onClick={() => dispatch({ type: "STAGE_GOTO", stage: st.key })} data-testid={`stage-${st.key}`}>
            {done ? <Check className="mr-1 h-3.5 w-3.5" /> : <span className="mr-1 text-xs opacity-70">{st.no}</span>}{st.label}
          </Button>
        );
      })}
    </div>
  );
}

function TanimaStage({ g, onName, onIdentifierOff, preview, onEditSimilar, existingCode }: Omit<Props, "words" | "ctx" | "dispatch">) {
  const ids = g.teach.identifiers.filter((d) => d.on);
  const similar: SimilarTemplate[] = preview.fresh ? (preview.result?.benzerSablonlar ?? []).filter((b) => b.kod !== existingCode) : [];
  return (
    <div className="space-y-2" data-testid="stage-tanima">
      <p className="text-sm text-muted-foreground">Bu tip belgede her zaman aynı olan yazılara dokunun (firma adı, belge başlığı). Önerilen başlık hazır seçili gelir.</p>
      <ul className="flex flex-wrap gap-1.5" data-testid="guided-identifiers">
        {ids.map((d) => (
          <li key={d.text} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-sm">
            {d.text}
            <Button type="button" size="icon" variant="ghost" className="h-5 w-5" aria-label={`${d.text} kimlik yazısını çıkar`} onClick={() => onIdentifierOff(d.text)} data-testid={`guided-identifier-off-${d.text}`}>
              <X className="h-3 w-3" />
            </Button>
          </li>
        ))}
      </ul>
      {ids.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Henüz kimlik yazısı seçilmedi.</p>}
      <p className="text-sm" data-testid="guided-confidence">{confidenceText(preview.result, preview.fresh)}</p>
      {similar[0] && (
        <p className="text-sm" data-testid="guided-similar">
          Benzeyen tip: <b>{similar[0].ad}</b> ·{" "}
          <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onEditSimilar(similar[0]!.kod)} data-testid="guided-similar-edit">Onu düzenle</button>
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">Belge tipinin adı</span>
        <Input value={g.teach.name} maxLength={80} onChange={(e) => onName(e.target.value)} placeholder="ör. Güleçsoy çeki listesi" data-testid="guided-name" />
      </label>
    </div>
  );
}

export function GuidedTeach(props: Props) {
  const { g, words, dispatch, ctx } = props;
  const at = stageIndex(g.stage);
  const blocked = stageProblems(g.stage, g.teach, words, ctx)[0] ?? null;
  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="guided-teach">
      <StageStrip g={g} words={words} dispatch={dispatch} ctx={ctx} />
      {g.stage === "TANIMA" && <TanimaStage {...props} />}
      {g.stage === "ESLEME" && <EslemeStage g={g} words={words} dispatch={dispatch} preview={props.preview} />}
      {g.stage === "KURALLAR" && <KurallarStage g={g} words={words} dispatch={dispatch} preview={props.preview} />}
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <Button type="button" size="sm" variant="ghost" disabled={at === 0} onClick={() => dispatch({ type: "STAGE_BACK" })} data-testid="stage-back"><ChevronLeft className="mr-1 h-4 w-4" /> Geri</Button>
        {blocked && <span className="min-w-0 flex-1 text-right text-xs text-amber-800 dark:text-amber-300" data-testid="stage-blocked">{blocked}</span>}
        {at < STAGES.length - 1 && (
          <Button type="button" size="sm" disabled={!!blocked} onClick={() => dispatch({ type: "STAGE_NEXT" })} data-testid="stage-next">İleri <ChevronRight className="ml-1 h-4 w-4" /></Button>
        )}
      </div>
    </div>
  );
}
