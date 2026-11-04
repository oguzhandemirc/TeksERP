// Rehberli tanıtma paneli (K30-T A2): başlık → alanlar sırayla → ad + kaydet. Kullanıcı yalnız DEĞERE dokunur; etiketi sunucu bulur,
// önizleme kendiliğinden koşar ve "Okunan: …" anında görünür. Durum geçişleri saf `guidedReduce`te.
// Sözleşme A2 "Etiketi değiştir" düğmesi: etiket seçimi sunucuda (anchor) ve istemciden ezilemez; düğme dürüstçe "Yeniden işaretle".
import { Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { chipStatus, fieldLabel, fieldReadout, FINISH_STEP, GUIDED_FIELDS, stepField, type GuidedEvent, type Readout } from "./guidedTeach";
import { isKept, type FieldKey, type TeachState } from "./teachDraft";
import type { SuggestResult } from "./types";

interface Props {
  state: TeachState;
  step: number;
  skipped: readonly FieldKey[];
  dispatch: (ev: GuidedEvent) => void;
  onName: (name: string) => void;
  preview: { result: SuggestResult | null; fresh: boolean; error: string | null };
  /** Güncelle kipinde eski şablonun alanları: işaretlenmeyen/atlanan alan sunucu birleştirmesinde eski haliyle KORUNUR. */
  oldKeys?: readonly string[];
}

const CHIP_TONE = { done: "border-emerald-600 text-emerald-700 dark:text-emerald-300", skipped: "border-dashed text-muted-foreground line-through", todo: "" } as const;

function ReadoutLine({ r }: { r: Readout }) {
  if (r.kind === "idle") return <p className="text-sm text-muted-foreground">Henüz dokunulmadı.</p>;
  if (r.kind === "loading") return <p className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Okunuyor…</p>;
  if (r.kind === "ok")
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300" data-testid="guided-readout-ok">
        Okunan: <strong>{r.value}</strong>{r.label ? <span className="text-muted-foreground"> (etiket: “{r.label}”)</span> : null}
      </p>
    );
  if (r.kind === "empty") return <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="guided-readout-fail">Okunamadı — işareti kaldırıp değerin kendisine yeniden dokunun ya da bu belgede yoksa atlayın.</p>;
  return <p className="text-sm text-destructive" data-testid="guided-readout-fail">{r.text}</p>;
}

export function GuidedTeach({ state, step, skipped, dispatch, onName, preview, oldKeys = [] }: Props) {
  const key = stepField(step);
  const keptOld = (k: FieldKey) => oldKeys.includes(k) && !state.fields[k]?.length;
  const steps = ["Başlık", ...GUIDED_FIELDS.map(fieldLabel), "Bitir"];
  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="guided-teach">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tanıtma adımları">
        {steps.map((label, i) => {
          const k = stepField(i);
          const st = k ? chipStatus(state, k, skipped) : "todo";
          return (
            <Button key={label} type="button" size="sm" role="tab" aria-selected={i === step} variant={i === step ? "default" : "outline"} className={cn(i !== step && CHIP_TONE[st])} onClick={() => dispatch({ type: "GOTO", step: i })} data-testid={`guided-chip-${i}`}>
              {st === "done" && <Check className="mr-1 h-3 w-3" />}{label}
            </Button>
          );
        })}
      </div>

      {step === 0 && (
        <div className="space-y-1" data-testid="guided-step-header">
          <p className="font-medium">Belgenin başlığına dokunun</p>
          <p className="text-sm text-muted-foreground">Firma adı ya da belge adı gibi her belgede aynı kalan yazı; sistem bu tipi bununla tanır. Önerilen başlık hazır seçili gelir.</p>
          <ul className="text-sm" data-testid="guided-identifiers">
            {state.identifiers.filter((d) => d.on).map((d) => <li key={d.text}>• {d.text}</li>)}
          </ul>
          {!state.identifiers.some((d) => d.on) && <p className="text-sm text-amber-700 dark:text-amber-300">Henüz başlık seçilmedi.</p>}
        </div>
      )}

      {key && (
        <div className="space-y-1" data-testid={`guided-step-${key}`}>
          <p className="font-medium">{fieldLabel(key)} değerine dokunun</p>
          <p className="text-sm text-muted-foreground">Etikete değil, değerin kendisine dokunun; yanındaki basılı etiketi sistem bulur.</p>
          <ReadoutLine r={fieldReadout(state, key, preview)} />
          {keptOld(key) && <p className="text-xs text-muted-foreground" data-testid="guided-kept-old">Eski şablondaki “{fieldLabel(key)}” tanımı korunur; değiştirmek için değere dokunun.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={() => dispatch({ type: "SKIP" })} data-testid="guided-skip"><SkipForward className="mr-1 h-4 w-4" /> Bu belgede yok</Button>
            {state.fields[key]?.length ? <Button type="button" size="sm" variant="outline" onClick={() => dispatch({ type: "RELABEL" })} data-testid="guided-relabel"><RotateCcw className="mr-1 h-4 w-4" /> Yeniden işaretle</Button> : null}
          </div>
        </div>
      )}

      {step === FINISH_STEP && (
        <div className="space-y-2" data-testid="guided-step-finish">
          <ul className="space-y-1 text-sm">
            {GUIDED_FIELDS.map((k) => (
              <li key={k} className="flex gap-2"><span className="w-32 shrink-0 text-muted-foreground">{fieldLabel(k)}</span>
                {state.fields[k]?.length || isKept(state, k) ? <ReadoutLine r={fieldReadout(state, k, preview)} /> : <span className="text-muted-foreground">{keptOld(k) ? "Eski şablondaki tanım korunur" : skipped.includes(k) ? "Bu belgede yok" : "—"}</span>}
              </li>
            ))}
          </ul>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Belge tipinin adı</span>
            <Input value={state.name} onChange={(e) => onName(e.target.value)} placeholder="ör. Güleçsoy çeki listesi" data-testid="guided-name" />
          </label>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={step === 0} onClick={() => dispatch({ type: "BACK" })} data-testid="guided-back"><ChevronLeft className="mr-1 h-4 w-4" /> Geri</Button>
        {step < FINISH_STEP && <Button type="button" size="sm" onClick={() => dispatch({ type: "NEXT" })} data-testid="guided-next">Sonraki <ChevronRight className="ml-1 h-4 w-4" /></Button>}
      </div>
    </div>
  );
}
