import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Code2, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeNotes } from "./CodeNotes";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { tableBindingsFromHtml } from "../binding/itemTable";
import { normalizePageSettings, pageSettingsIssues, type PageSettings } from "../binding/pageSettings";
import type { ContractView } from "../binding/contract";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { CODE_MODE_WARNING, SWITCH_TO_CODE_CONFIRM, VISUAL_READONLY_NOTE, isCodeEditable, visualReturnBlocker, type EditMode } from "./editMode";
import type { ServerIssue } from "./issueDiagnostics";
import { buildCompletionModel } from "./liquidCompletion";
import type { DesignerSource } from "./useDesignerSource";

export type CodeTab = "html" | "css" | "page";

const TABS: ReadonlyArray<{ key: CodeTab; label: string }> = [
  { key: "html", label: "HTML + Liquid" },
  { key: "css", label: "CSS" },
  { key: "page", label: "Sayfa JSON" },
];

export const EXCEL_DEFAULT_COLUMNS_NOTE =
  "Kalem tablosu bağı (data-tablo / data-kolon) yok — bu şablonun Excel çıktısı varsayılan kolonlarla üretilir.";

interface Props {
  mode: EditMode;
  source: DesignerSource;
  contract: ContractView | null;
  internalFields: readonly string[];
  pageSettings: PageSettings;
  issues: readonly ServerIssue[];
  tab: CodeTab;
  onTab: (t: CodeTab) => void;
  onCode: (patch: Partial<DesignerSource>) => void;
  onPageSettings: (p: PageSettings) => void;
  onSwitchToCode: () => void;
  onReturnToVisual: () => void;
}

/** Kod sekmeleri (plan §4): görsel kipte salt-okunur; "Koda geç" onayla CODE kipine alır. */
export const CodePanel = forwardRef<CodeEditorHandle, Props>(function CodePanel(props, htmlRef) {
  const { mode, source, contract, internalFields, pageSettings, issues, tab, onTab, onCode, onPageSettings } = props;
  const editable = isCodeEditable(mode);
  const [confirming, setConfirming] = useState(false);
  const completion = useMemo(() => buildCompletionModel(contract, internalFields), [contract, internalFields]);
  const blocker = mode === "CODE" ? visualReturnBlocker(source.html) : null;

  const [jsonText, onJson] = usePageJson(pageSettings, onPageSettings);
  const pageIssues = pageSettingsIssues(pageSettings);
  const excelNote = mode === "CODE" && (contract?.tablolar.length ?? 0) > 0 && Object.keys(tableBindingsFromHtml(source.html)).length === 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="kod-paneli">
      <ModeBar tab={tab} onTab={onTab} editable={editable} blocker={blocker} onReturn={props.onReturnToVisual} onCode={() => setConfirming(true)} />
      {/* Uyarılar tek satır + daraltılabilir (CodeNotes) — üst üste kutular 1280×720'de editörü sıkıştırıyordu. */}
      <CodeNotes
        notes={[
          editable
            ? { tone: "warning", text: `${CODE_MODE_WARNING}${blocker ? ` ${blocker}` : ""}`, testId: "kip-uyarisi" }
            : { tone: "muted", text: VISUAL_READONLY_NOTE, testId: "kip-uyarisi" },
          ...(excelNote ? [{ tone: "info" as const, text: EXCEL_DEFAULT_COLUMNS_NOTE, testId: "excel-uyarisi" }] : []),
          ...(tab === "page" && pageIssues.length > 0 ? [{ tone: "warning" as const, text: pageIssues.join(" · ") }] : []),
        ]}
      />
      <div className="relative min-h-0 min-w-0 flex-1 p-2">
        <div className={cn("h-full overflow-hidden rounded-md border", tab !== "html" && "hidden")}>
          <CodeEditor ref={htmlRef} value={source.html} language="html" readOnly={!editable} onChange={(html) => onCode({ html })} completion={completion} issues={issues} ariaLabel="HTML ve Liquid kaynağı" />
        </div>
        <div className={cn("h-full overflow-hidden rounded-md border", tab !== "css" && "hidden")}>
          <CodeEditor value={source.css} language="css" readOnly={!editable} onChange={(css) => onCode({ css })} ariaLabel="CSS kaynağı" />
        </div>
        <div className={cn("h-full overflow-hidden rounded-md border", tab !== "page" && "hidden")}>
          <CodeEditor value={jsonText} language="json" readOnly={!editable} onChange={onJson} ariaLabel="Sayfa ayarları JSON" />
        </div>
      </div>
      <SwitchToCodeDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          props.onSwitchToCode();
        }}
      />
    </div>
  );
});

/** Sayfa JSON: yazılan metin yerelde tutulur; yalnız geçerli JSON taslağa akar (yazarken geri yankı yok). */
function usePageJson(pageSettings: PageSettings, onPageSettings: (p: PageSettings) => void): [string, (t: string) => void] {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(pageSettings, null, 2));
  const lastApplied = useRef(JSON.stringify(pageSettings));
  useEffect(() => {
    const s = JSON.stringify(pageSettings);
    if (s === lastApplied.current) return;
    lastApplied.current = s;
    setJsonText(JSON.stringify(pageSettings, null, 2));
  }, [pageSettings]);
  const onJson = (text: string) => {
    setJsonText(text);
    try {
      const next = normalizePageSettings(JSON.parse(text));
      lastApplied.current = JSON.stringify(next);
      onPageSettings(next);
    } catch {
      // Ayrıştırma hatası editörde altı çizili (jsonParseLinter); taslak değişmez.
    }
  };
  return [jsonText, onJson];
}

interface ModeBarProps {
  tab: CodeTab;
  onTab: (t: CodeTab) => void;
  editable: boolean;
  blocker: string | null;
  onReturn: () => void;
  onCode: () => void;
}

function ModeBar({ tab, onTab, editable, blocker, onReturn, onCode }: ModeBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5">
      <div role="tablist" aria-label="Kod sekmeleri" className="flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={cn("px-3 py-1.5 text-xs font-medium", tab === t.key ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", editable ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
        {editable ? "Kod kipi" : "Görsel kip · salt-okunur"}
      </span>
      <div className="ml-auto">
        {editable ? (
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!!blocker} title={blocker ?? "Görsel düzenleyiciye dön"} onClick={onReturn}>
            <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" /> Görsele dön
          </Button>
        ) : (
          <Button size="sm" className="h-8 text-xs" onClick={onCode}>
            <Code2 className="mr-1.5 h-3.5 w-3.5" /> Koda geç
          </Button>
        )}
      </div>
    </div>
  );
}

function SwitchToCodeDialog({ open, onCancel, onConfirm }: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Koda geç</DialogTitle>
          <DialogDescription>{SWITCH_TO_CODE_CONFIRM}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button onClick={onConfirm}>Koda geç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
