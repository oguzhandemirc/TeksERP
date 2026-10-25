import { useState } from "react";
import { Database, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { issueLabel, type ServerIssue } from "../code/issueDiagnostics";
import { openPdfPreview } from "./pdfPreview";
import type { PreviewState } from "./usePreview";

export const PREVIEW_IFRAME_TITLE = "Belge önizlemesi";

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
}

interface Props {
  state: PreviewState;
  sampleText: string;
  onSample: () => void;
  onIssue: (i: ServerIssue) => void;
  docType: string;
  title: string;
  className?: string;
}

/** Canlı önizleme: sunucunun çizdiği HTML `sandbox=""` iframe'de (script yok, köken yok). */
export function PreviewPane({ state, sampleText, onSample, onIssue, docType, title, className }: Props) {
  const { result, lastGood, status } = state;
  const shown = status === "ok" ? result : lastGood;
  const stale = status !== "ok" && !!lastGood;
  const pdf = usePdfPreview(docType, title);
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)} data-testid="onizleme-paneli">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5 text-xs">
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onSample} title="Örnek veriyi değiştir">
          <Database className="mr-1.5 h-3.5 w-3.5" /> Örnek: {sampleText}
        </Button>
        {status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Önizleme yenileniyor" />}
        {result && result.olcum.bayt > 0 && (
          <span className="text-muted-foreground" data-testid="onizleme-olcum">{result.olcum.ms} ms · {formatBytes(result.olcum.bayt)}</span>
        )}
        <Button size="sm" className="ml-auto h-8 text-xs" disabled={status !== "ok" || !result?.html || pdf.busy} onClick={() => result && void pdf.run(result.html)}>
          {pdf.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />} PDF önizleme
        </Button>
      </div>
      <PreviewStrip state={state} onIssue={onIssue} />
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/40 p-2">
        {shown ? (
          <iframe title={PREVIEW_IFRAME_TITLE} sandbox="" srcDoc={shown.html} className={cn("h-full w-full rounded border bg-white transition-opacity", stale && "opacity-40")} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === "loading" || status === "idle" ? "Önizleme hazırlanıyor…" : "Önizleme yok — hataları düzeltin."}
          </div>
        )}
      </div>
      <PdfFallbackDialog pages={pdf.fallback} onClose={() => pdf.setFallback(undefined)} onSave={() => result && void pdf.save(result.html)} />
    </div>
  );
}

function PreviewStrip({ state, onIssue }: { state: PreviewState; onIssue: (i: ServerIssue) => void }) {
  const { result, message } = state;
  const issues = result?.hatalar ?? [];
  const warnings = result?.uyarilar ?? [];
  const cut = result?.kesilenler ?? [];
  if (!message && !issues.length && !warnings.length && !cut.length) return null;
  return (
    <div className="max-h-40 shrink-0 space-y-1 overflow-y-auto border-b px-2 py-1.5 text-xs" data-testid="onizleme-seridi">
      {message && <p className="text-amber-700 dark:text-amber-300">{message}</p>}
      {issues.map((i, n) => (
        <button key={`e${n}`} type="button" onClick={() => onIssue(i)} className="block w-full rounded px-1 text-left text-destructive hover:bg-destructive/10" title="Kodda göster">
          {issueLabel(i)}
        </button>
      ))}
      {warnings.map((w, n) => <p key={`w${n}`} className="px-1 text-amber-700 dark:text-amber-300">{w}</p>)}
      {cut.length > 0 && (
        <details className="px-1 text-muted-foreground">
          <summary className="cursor-pointer">Temizleyicinin kestiği içerik ({cut.length})</summary>
          <ul className="ml-4 list-disc">{cut.map((c, n) => <li key={n} className="font-mono">{c}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function usePdfPreview(docType: string, title: string) {
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<number | null | undefined>(undefined);
  const run = async (html: string) => {
    setBusy(true);
    try {
      const r = await openPdfPreview(html, title, docType);
      if (r.kind === "error") toast.error(r.message);
      else if (r.kind === "fallback") setFallback(r.pages);
    } finally {
      setBusy(false);
    }
  };
  const save = async (html: string) => {
    const r = await window.api.pdf.save({ html, suggestedName: title });
    if (r.error) toast.error(r.error);
    setFallback(undefined);
  };
  return { busy, run, fallback, setFallback, save };
}

/** Yedek yol: görüntüleyici açılamadıysa sayfa sayısı + "PDF Kaydet". */
function PdfFallbackDialog({ pages, onClose, onSave }: { pages: number | null | undefined; onClose: () => void; onSave: () => void }) {
  return (
    <Dialog open={pages !== undefined} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>PDF hazır</DialogTitle>
          <DialogDescription>
            PDF görüntüleyicisi açılamadı. {pages ? `Belge ${pages} sayfa.` : "Sayfa sayısı okunamadı."} Kaydedip açabilirsiniz.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button onClick={onSave}>PDF Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
