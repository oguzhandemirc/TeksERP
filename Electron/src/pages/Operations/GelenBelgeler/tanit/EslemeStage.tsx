// ② Eşleme: belge alanı → iş emri karşılığı. Satırı seç, sonra belgede DEĞERE dokun (etiketi sunucu bulur). Gruplar çerçeveyle ayrılır
// (başlık satırı yok); hedef/diğer alanlar "Diğer alanlar" açılırında; top tablosu sütunları isteğe bağlı son çerçeve.
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RotateCcw, SkipForward, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FIELD_GROUP_LABEL, FIELD_GROUP_ORDER, fieldTargetOf } from "./fieldTargets";
import { fieldLabel, fieldReadout, type GuidedEvent, type GuidedState, type Readout } from "./guidedTeach";
import { MAIN_FIELDS, METER_KG_CLASH_PREFIX, OTHER_FIELDS } from "./stages";
import { COLUMN_OPTIONS, isKept, textOf, type FieldKey, type TeachState } from "./teachDraft";
import type { ScanWord, SuggestResult } from "./types";

export interface PreviewInfo {
  result: SuggestResult | null;
  fresh: boolean;
  error: string | null;
}

interface Props {
  g: GuidedState;
  words: readonly ScanWord[];
  dispatch: (ev: GuidedEvent) => void;
  preview: PreviewInfo;
}

export function ReadoutLine({ r }: { r: Readout }) {
  if (r.kind === "idle") return <p className="text-sm text-muted-foreground">Henüz dokunulmadı — belgede değerin kendisine dokunun.</p>;
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

function RowState({ s, k, skipped, preview, dispatch }: { s: TeachState; k: FieldKey; skipped: readonly FieldKey[]; preview: PreviewInfo; dispatch: Props["dispatch"] }) {
  if (s.drop.includes(k)) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="line-through">Kaldırılacak</span>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => dispatch({ type: "DROP_FIELD", key: k, on: false })} data-testid={`map-undrop-${k}`}><Undo2 className="mr-1 h-3 w-3" /> Geri al</Button>
      </span>
    );
  }
  const r = fieldReadout(s, k, preview);
  const value = r.kind === "ok" ? r.value : s.fields[k]?.length ? "…" : null;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {isKept(s, k) && <span className="rounded-full border px-1.5 text-[11px] text-muted-foreground" data-testid={`map-kept-${k}`}>Önceki tanımdan</span>}
      <span className={cn("tabular-nums", !value && "text-muted-foreground")}>{value ?? (skipped.includes(k) ? "Bu belgede yok" : "—")}</span>
      {isKept(s, k) && (
        <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => dispatch({ type: "DROP_FIELD", key: k, on: true })} aria-label={`${fieldLabel(k)} alanını kaldır`} data-testid={`map-drop-${k}`}><X className="mr-1 h-3 w-3" /> Kaldır</Button>
      )}
    </span>
  );
}

function ActiveField({ g, k, preview, dispatch }: { g: GuidedState; k: FieldKey; preview: PreviewInfo; dispatch: Props["dispatch"] }) {
  return (
    <div className="space-y-1 border-t bg-primary/5 px-2.5 py-2" data-testid={`guided-step-${k}`}>
      <ReadoutLine r={fieldReadout(g.teach, k, preview)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => dispatch({ type: "SKIP" })} data-testid="guided-skip"><SkipForward className="mr-1 h-4 w-4" /> Bu belgede yok</Button>
        {g.teach.fields[k]?.length ? <Button type="button" size="sm" variant="outline" onClick={() => dispatch({ type: "RELABEL" })} data-testid="guided-relabel"><RotateCcw className="mr-1 h-4 w-4" /> Yeniden işaretle</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={() => dispatch({ type: "NEXT" })} data-testid="guided-next">Sonraki alan <ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function FieldRows({ keys, g, preview, dispatch }: { keys: readonly FieldKey[]; g: GuidedState; preview: PreviewInfo; dispatch: Props["dispatch"] }) {
  return (
    <>
      {FIELD_GROUP_ORDER.map((grp) => {
        const inGroup = keys.filter((k) => fieldTargetOf(k)?.group === grp);
        if (inGroup.length === 0) return null;
        return (
          <ul key={grp} className="overflow-hidden rounded-md border" aria-label={FIELD_GROUP_LABEL[grp]}>
            {inGroup.map((k) => {
              const active = g.target?.kind === "field" && g.target.key === k;
              return (
                <li key={k} className={cn("border-b last:border-b-0", active && "ring-2 ring-inset ring-primary")}>
                  <div className="flex items-center justify-between gap-2 px-2.5 py-1">
                    <button type="button" className={cn("min-w-0 flex-1 py-1 text-left text-sm", active && "font-semibold")} aria-pressed={active} onClick={() => dispatch({ type: "GOTO", target: { kind: "field", key: k } })} data-testid={`map-row-${k}`}>
                      {fieldLabel(k)}
                    </button>
                    <RowState s={g.teach} k={k} skipped={g.skipped} preview={preview} dispatch={dispatch} />
                  </div>
                  {active && <ActiveField g={g} k={k} preview={preview} dispatch={dispatch} />}
                </li>
              );
            })}
          </ul>
        );
      })}
    </>
  );
}

function TableColumns({ g, words, dispatch }: Omit<Props, "preview">) {
  return (
    <ul className="overflow-hidden rounded-md border border-dashed" aria-label="Top tablosu (isteğe bağlı)" data-testid="map-table">
      <li className="px-2.5 pt-1.5 text-xs text-muted-foreground">Top tablosu (isteğe bağlı) — sütunu seçip belgede sütun BAŞLIĞINA dokunun.</li>
      {COLUMN_OPTIONS.map((c) => {
        const active = g.target?.kind === "column" && g.target.key === c.key;
        const idx = g.teach.columns[c.key];
        return (
          <li key={c.key} className={cn("flex items-center justify-between gap-2 px-2.5 py-1", active && "ring-2 ring-inset ring-primary")}>
            <button type="button" className={cn("flex-1 py-1 text-left text-sm", active && "font-semibold")} aria-pressed={active} onClick={() => dispatch({ type: "GOTO", target: { kind: "column", key: c.key } })} data-testid={`map-column-${c.key}`}>
              {c.label}
            </button>
            <span className={cn("text-sm", !idx?.length && "text-muted-foreground")}>{idx?.length ? `“${textOf(words, idx)}”` : "—"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function EslemeStage({ g, words, dispatch, preview }: Props) {
  const othersInUse = OTHER_FIELDS.filter((k) => g.teach.fields[k]?.length || isKept(g.teach, k)).length;
  const targetInOthers = g.target?.kind === "field" && OTHER_FIELDS.includes(g.target.key);
  const [openOthers, setOpenOthers] = useState(othersInUse > 0);
  const clashes = preview.fresh ? (preview.result?.errors ?? []).filter((e) => e.startsWith(METER_KG_CLASH_PREFIX)) : [];
  return (
    <div className="space-y-2" data-testid="stage-esleme">
      <p className="text-sm text-muted-foreground">Satırı seçin, sonra belgede değerin kendisine dokunun (etikete değil); basılı etiketi sistem bulur.</p>
      <FieldRows keys={MAIN_FIELDS} g={g} preview={preview} dispatch={dispatch} />
      <Button type="button" size="sm" variant="ghost" className="px-1.5" onClick={() => setOpenOthers((o) => !o)} aria-expanded={openOthers || targetInOthers} data-testid="map-others-toggle">
        {openOthers || targetInOthers ? <ChevronDown className="mr-1 h-4 w-4" /> : <ChevronRight className="mr-1 h-4 w-4" />}
        Diğer alanlar{othersInUse ? ` (${othersInUse} işaretli)` : ""}
      </Button>
      {(openOthers || targetInOthers) && <FieldRows keys={OTHER_FIELDS} g={g} preview={preview} dispatch={dispatch} />}
      <TableColumns g={g} words={words} dispatch={dispatch} />
      {clashes.map((c) => <p key={c} className="text-sm text-destructive" data-testid="map-clash">{c}</p>)}
    </div>
  );
}
