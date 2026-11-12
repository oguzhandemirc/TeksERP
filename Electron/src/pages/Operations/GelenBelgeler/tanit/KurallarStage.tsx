// ③ Kurallar: tekrar eden bölüm (Hayır/Evet + başlangıç yazısına dokun) · birden çok parti (Fabrika ayarı = alan yok = bugünkü
// davranış) · toplam satırı (dokun) · gelen metre kaynağı (salt bilgi; sunucunun `meterSources` önerisi — değiştirmek için ②).
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getIncomingDocumentSettings, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "../service";
import type { PreviewInfo } from "./EslemeStage";
import { fieldLabel, type GuidedEvent, type GuidedState, type Target } from "./guidedTeach";
import { meterSourceText, sectionText } from "./stages";
import { textOf } from "./teachDraft";
import type { ScanWord } from "./types";
import { MultiPartyChoice } from "./UserTemplateEdit";

interface Props {
  g: GuidedState;
  words: readonly ScanWord[];
  dispatch: (ev: GuidedEvent) => void;
  preview: PreviewInfo;
}

function Rule({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <div className="space-y-1.5 rounded-md border px-3 py-2" data-testid={testId}>
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function TapTarget({ g, target, text, dispatch, testId }: { g: GuidedState; target: Target; text: string; dispatch: Props["dispatch"]; testId: string }) {
  const active = g.target?.kind === target.kind;
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => dispatch({ type: "GOTO", target })} data-testid={testId}>
      <MousePointerClick className="mr-1 h-4 w-4" /> {text}
    </Button>
  );
}

function RepeatsRule({ g, dispatch, preview }: Omit<Props, "words">) {
  const s = g.teach;
  const info = sectionText(s, preview.result, preview.fresh);
  return (
    <Rule title="Belgede her parti ayrı blok mu?" testId="rule-repeats">
      <div className="flex gap-2" role="radiogroup" aria-label="Belgede her parti ayrı blok mu?">
        {[false, true].map((on) => (
          <Button key={String(on)} type="button" size="sm" role="radio" aria-checked={s.repeats === on} variant={s.repeats === on ? "default" : "outline"} onClick={() => dispatch({ type: "SET_RULE", set: { rule: "repeats", on } })} data-testid={`rule-repeats-${on ? "yes" : "no"}`}>
            {on ? "Evet" : "Hayır"}
          </Button>
        ))}
      </div>
      {s.repeats && (
        <>
          <TapTarget g={g} target={{ kind: "sectionStart" }} text={s.sectionStart ? "Başlangıç yazısını değiştir" : "Bölüm başlangıç yazısına dokunun"} dispatch={dispatch} testId="rule-section-start" />
          <p className={cn("text-sm", info ? "" : "text-muted-foreground")} data-testid="rule-section-info">{info ?? "Her bölümün başındaki yazıya (ör. PARTİ NO) belgede dokunun."}</p>
          {s.sectionFields.length > 0 && <p className="text-xs text-muted-foreground">Bölüm başına okunan: {s.sectionFields.map(fieldLabel).join(", ")}</p>}
        </>
      )}
    </Rule>
  );
}

function TotalsRule({ g, words, dispatch }: Omit<Props, "preview">) {
  const s = g.teach;
  if (Object.keys(s.columns).length === 0) {
    return (
      <Rule title="Toplam satırı" testId="rule-totals">
        <p className="text-sm text-muted-foreground">Belgede top tablosu işaretlenmedi; toplam satırı için önce ② Eşleme'de tablonun sütun başlıklarını işaretleyin.</p>
      </Rule>
    );
  }
  return (
    <Rule title="Toplam satırı" testId="rule-totals">
      <TapTarget g={g} target={{ kind: "totals" }} text="Toplam satırının yazısına dokunun (ör. T.Adet)" dispatch={dispatch} testId="rule-totals-tap" />
      <p className="text-sm" data-testid="rule-totals-text">
        {s.totalsLabel?.length ? <>“{textOf(words, s.totalsLabel)}” — gelen metre bu satırdan okunur.</> : <span className="text-muted-foreground">Seçilmedi (isteğe bağlı).</span>}
      </p>
    </Rule>
  );
}

export function KurallarStage({ g, words, dispatch, preview }: Props) {
  const factory = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, staleTime: 60_000 });
  return (
    <div className="space-y-2" data-testid="stage-kurallar">
      <RepeatsRule g={g} dispatch={dispatch} preview={preview} />
      <div className="rounded-md border px-3 py-2" data-testid="rule-multi-party">
        <MultiPartyChoice value={g.teach.multiParty} factory={factory.data?.multiPartyWorkOrder} onChange={(value) => dispatch({ type: "SET_RULE", set: { rule: "multiParty", value } })} />
      </div>
      <TotalsRule g={g} words={words} dispatch={dispatch} />
      <Rule title="Gelen metre kaynağı" testId="rule-meter-source">
        <p className="text-sm">{meterSourceText(preview.fresh ? preview.result : null)}</p>
        <p className="text-xs text-muted-foreground">Bilgi amaçlı; yanlışsa ② Eşleme'de "Gelen metre"yi ya da tablonun Metre sütununu düzeltin.</p>
      </Rule>
    </div>
  );
}
