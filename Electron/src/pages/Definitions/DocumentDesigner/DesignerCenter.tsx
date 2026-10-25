import { useRef, useState } from "react";
import type { Editor } from "grapesjs";
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CmRuler } from "./CmRuler";
import { CodePanel, type CodeTab } from "./code/CodePanel";
import type { CodeEditorHandle } from "./code/CodeEditor";
import { CODE_MODE_WARNING } from "./code/editMode";
import { exportVisual, useDesignerSource } from "./code/useDesignerSource";
import type { DesignerDraft } from "./useDesignerDraft";
import type { DesignerRefs, PageFrame } from "./useDesignerEditor";

export type CenterView = "design" | "code";

const CENTER_VIEWS: ReadonlyArray<{ key: CenterView; label: string }> = [
  { key: "design", label: "Tasarım" },
  { key: "code", label: "Kod" },
];

function CenterTabs({ view, onView }: { view: CenterView; onView: (v: CenterView) => void }) {
  return (
    <div role="tablist" aria-label="Görünüm" className="flex shrink-0 border-b bg-card px-2">
      {CENTER_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={view === v.key}
          onClick={() => onView(v.key)}
          className={cn("px-3 py-1.5 text-xs font-medium", view === v.key ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Kod kipinde kanvas örtülür: kaynak artık kod sekmesindedir (D3 "görsel düzenleme kısıtlı"). */
function CodeModeOverlay({ onGo }: { onGo: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-6 backdrop-blur-[1px]" data-testid="kod-kipi-ortusu">
      <div className="max-w-sm space-y-3 rounded-md border bg-card p-4 text-center text-sm shadow-sm">
        <p>{CODE_MODE_WARNING}</p>
        <Button size="sm" onClick={onGo}>
          <Code2 className="mr-1.5 h-4 w-4" /> Kod sekmesine git
        </Button>
      </div>
    </div>
  );
}

interface Props {
  refs: DesignerRefs;
  editor: Editor | null;
  draft: DesignerDraft;
  widthMm: number;
  frame: PageFrame;
}

/** Orta alan: Tasarım (GrapesJS kanvası, hep bağlı — editör bir kez kurulur) · Kod sekmeleri. */
export function DesignerCenter({ refs, editor, draft, widthMm, frame }: Props) {
  const [view, setView] = useState<CenterView>("design");
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const htmlEditor = useRef<CodeEditorHandle>(null);
  const source = useDesignerSource(editor, draft.editMode, draft.code);
  const switchToCode = () => {
    if (!editor) return;
    draft.setEditMode("CODE", exportVisual(editor));
    setView("code");
  };
  const returnToVisual = () => {
    if (!editor) return;
    editor.setComponents(draft.code.html);
    editor.setStyle(draft.code.css);
    draft.setEditMode("VISUAL");
    setView("design");
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <CenterTabs view={view} onView={setView} />
      <div ref={refs.area} className={cn("relative flex min-h-0 flex-1 flex-col bg-muted/40", view !== "design" && "hidden")}>
        <CmRuler widthMm={widthMm} left={frame.left} width={frame.width} />
        <div ref={refs.container} className="min-h-0 flex-1" />
        {draft.editMode === "CODE" && <CodeModeOverlay onGo={() => setView("code")} />}
      </div>
      {view === "code" && (
        <CodePanel
          ref={htmlEditor}
          mode={draft.editMode}
          source={source}
          contract={draft.contract}
          internalFields={draft.internalFields}
          pageSettings={draft.pageSettings}
          issues={[]}
          tab={codeTab}
          onTab={setCodeTab}
          onCode={draft.setCode}
          onPageSettings={draft.setPageSettings}
          onSwitchToCode={switchToCode}
          onReturnToVisual={returnToVisual}
        />
      )}
    </div>
  );
}
