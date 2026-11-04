// Tanıtma sayfasının sağ sütunu: kip seçimi (Adım adım | Gelişmiş), rehber ya da serbest panel, eksikler, Önizle/Kaydet ve
// benzer şablon diyaloğu. Kaydet tek tıktır: bayat önizlemeyi kendisi tazeler (useTeach.save).
import { Eye, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FINISH_STEP, type GuidedEvent } from "./guidedTeach";
import { GuidedTeach } from "./GuidedTeachPanel";
import { SimilarDialog } from "./SimilarDialog";
import { TeachPanel } from "./TeachPanel";
import { TeachPreview } from "./TeachPreview";
import { oldTemplateFieldKeys, type FieldKey } from "./teachDraft";
import type { UserTemplateDetail } from "./types";
import type { TeachHook } from "./useTeach";

interface Props {
  t: TeachHook;
  existing: UserTemplateDetail | null;
  advanced: boolean;
  onAdvanced: (on: boolean) => void;
  nav: { step: number; skipped: FieldKey[] };
  dispatch: (ev: GuidedEvent) => void;
}

export function TeachControls({ t, existing, advanced, onAdvanced, nav, dispatch }: Props) {
  if (!t.state || !t.words.data) return null;
  const showProblems = advanced || nav.step === FINISH_STEP;
  return (
    <>
      <div className="flex gap-1" role="group" aria-label="Tanıtma kipi">
        <Button size="sm" variant={advanced ? "outline" : "default"} onClick={() => onAdvanced(false)} data-testid="teach-mode-guided">Adım adım</Button>
        <Button size="sm" variant={advanced ? "default" : "outline"} onClick={() => onAdvanced(true)} data-testid="teach-mode-advanced">Gelişmiş (tablo, bölüm)</Button>
      </div>
      {advanced ? (
        <>
          <TeachPanel state={t.state} words={t.words.data.words} onChange={t.setState} old={existing?.template ?? null} />
          {t.preview && <TeachPreview result={t.preview} stale={!t.previewFresh} />}
        </>
      ) : (
        <GuidedTeach
          state={t.state}
          step={nav.step}
          skipped={nav.skipped}
          dispatch={dispatch}
          onName={(name) => t.setState((s) => ({ ...s, name }))}
          preview={{ result: t.preview, fresh: t.previewFresh, error: t.previewError }}
          oldKeys={oldTemplateFieldKeys(existing?.template)}
        />
      )}
      {showProblems && t.problems.length > 0 && <ul className="text-xs text-amber-800 dark:text-amber-300" data-testid="teach-problems">{t.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex justify-end gap-2">
        {advanced && (
          <Button variant="outline" onClick={t.runPreview} disabled={t.previewProblems.length > 0 || t.previewing} data-testid="teach-preview-run">
            <Eye className="mr-1 h-4 w-4" /> {t.previewing ? "Önizleniyor…" : "Önizle"}
          </Button>
        )}
        <Button onClick={() => void t.save()} disabled={!t.canSave} data-testid="teach-save">
          <Save className="mr-1 h-4 w-4" /> {t.saving ? "Kaydediliyor…" : existing ? "Şablonu güncelle" : "Belge tipini kaydet"}
        </Button>
      </div>
      <SimilarDialog similar={t.similar} currentName={existing?.name ?? null} onSame={(kod) => void t.save({ same: kod })} onNew={() => void t.save("new")} onDismiss={t.closeSimilar} />
    </>
  );
}
