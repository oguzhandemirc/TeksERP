// Tanıtma sayfasının sağ sütunu: rehberli 3 aşama (varsayılan) ya da "Serbest işaretleme" (bugünkü serbest panel), eksikler, kaydet
// çubuğu ("3 kimlik yazısı · 7 alan · 2 kural" + Kaydet) ve benzer şablon diyaloğu. Kaydet tek tıktır: bayat önizlemeyi tazeler (useTeach.save).
import { Eye, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuidedEvent, GuidedState } from "./guidedTeach";
import { GuidedTeach } from "./GuidedTeachPanel";
import { SimilarDialog } from "./SimilarDialog";
import { teachSummary } from "./stages";
import { TeachPanel } from "./TeachPanel";
import { TeachPreview } from "./TeachPreview";
import { toggleIdentifier } from "./teachDraft";
import type { UserTemplateDetail } from "./types";
import type { TeachHook } from "./useTeach";

interface Props {
  t: TeachHook;
  existing: UserTemplateDetail | null;
  advanced: boolean;
  onAdvanced: (on: boolean) => void;
  g: GuidedState | null;
  dispatch: (ev: GuidedEvent) => void;
  onEditSimilar: (code: string) => void;
}

function ModeLink({ advanced, onAdvanced }: Pick<Props, "advanced" | "onAdvanced">) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{advanced ? "Serbest işaretleme" : "Adım adım tanıtma"}</span>
      {advanced ? (
        <Button size="sm" variant="link" className="h-auto p-0" onClick={() => onAdvanced(false)} data-testid="teach-mode-guided">Adım adım'a dön</Button>
      ) : (
        <Button size="sm" variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => onAdvanced(true)} data-testid="teach-mode-advanced">Serbest işaretleme</Button>
      )}
    </div>
  );
}

export function TeachControls({ t, existing, advanced, onAdvanced, g, dispatch, onEditSimilar }: Props) {
  if (!t.state || !t.words.data) return null;
  const words = t.words.data.words;
  const showProblems = advanced || g?.stage === "KURALLAR";
  return (
    <>
      <ModeLink advanced={advanced} onAdvanced={onAdvanced} />
      {advanced || !g ? (
        <>
          <TeachPanel state={t.state} words={words} onChange={t.setState} old={existing?.template ?? null} />
          {t.preview && <TeachPreview result={t.preview} stale={!t.previewFresh} />}
        </>
      ) : (
        <GuidedTeach
          g={g}
          words={words}
          dispatch={dispatch}
          onName={(name) => t.setState((s) => ({ ...s, name }))}
          onIdentifierOff={(text) => t.setState((s) => toggleIdentifier(s, text))}
          preview={{ result: t.preview, fresh: t.previewFresh, error: t.previewError }}
          ctx={t.stageCtx}
          onEditSimilar={onEditSimilar}
          existingCode={existing?.code ?? null}
        />
      )}
      {showProblems && t.problems.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="teach-problems">{t.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-sm text-muted-foreground" data-testid="teach-summary">{teachSummary(t.state)}</span>
        {advanced && (
          <Button variant="outline" onClick={t.runPreview} disabled={t.previewProblems.length > 0 || t.previewing} data-testid="teach-preview-run">
            <Eye className="mr-1 h-4 w-4" /> {t.previewing ? "Önizleniyor…" : "Önizle"}
          </Button>
        )}
        <Button onClick={() => void t.save()} disabled={!t.canSave} data-testid="teach-save">
          <Save className="mr-1 h-4 w-4" /> {t.saving ? "Kaydediliyor…" : existing ? "Tanımı kaydet" : "Belge tipini kaydet"}
        </Button>
      </div>
      <SimilarDialog similar={t.similar} currentName={existing?.name ?? null} onSame={(kod) => void t.save({ same: kod })} onNew={() => void t.save("new")} onDismiss={t.closeSimilar} />
    </>
  );
}
