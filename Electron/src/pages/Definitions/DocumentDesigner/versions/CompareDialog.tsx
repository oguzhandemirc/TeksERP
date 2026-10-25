import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { documentTemplateService, type DocumentTemplateRow, type TemplateVersionSummary } from "@/services/documentTemplateService";
import { SandboxFrame } from "../templates/SandboxFrame";
import { DiffView } from "./DiffView";
import { versionPreviewRequest } from "./versionSource";

export interface CompareTarget {
  template: DocumentTemplateRow;
  /** Eski → yeni sırasıyla. */
  pair: [TemplateVersionSummary, TemplateVersionSummary];
}

type View = "preview" | "html" | "css";
const VIEWS: ReadonlyArray<{ key: View; label: string }> = [
  { key: "preview", label: "Yan yana önizleme" },
  { key: "html", label: "HTML farkı" },
  { key: "css", label: "CSS farkı" },
];

/** İki sürüm (salt-okunur): sunucuda çizilmiş iki önizleme + kaynak satır farkı. Hiçbir şey yazılmaz. */
export function CompareDialog({ target, onClose }: { target: CompareTarget | null; onClose: () => void }) {
  const [view, setView] = useState<View>("preview");
  const q = useQuery({
    queryKey: ["document-templates", "compare", target?.pair[0].id, target?.pair[1].id],
    enabled: !!target,
    queryFn: async () => {
      const { template, pair } = target!;
      const [a, b, contract] = await Promise.all([
        documentTemplateService.version(template.id, pair[0].id),
        documentTemplateService.version(template.id, pair[1].id),
        documentTemplateService.contract(template.docType),
      ]);
      const senaryo = contract.data.senaryolar[0]?.ad;
      const render = async (v: typeof a.data) =>
        senaryo ? (await documentTemplateService.preview(versionPreviewRequest(template.docType, v, senaryo))).data.html : "";
      const [ha, hb] = await Promise.all([render(a.data), render(b.data)]);
      return { a: a.data, b: b.data, ha, hb, senaryo };
    },
  });
  const [va, vb] = target?.pair ?? [];
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>v{va?.versionNo} ↔ v{vb?.versionNo} karşılaştırma</DialogTitle>
          <DialogDescription>{target?.template.name} · salt-okunur{q.data?.senaryo ? ` · örnek: ${q.data.senaryo}` : ""}</DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Karşılaştırma görünümü" className="flex border-b">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={cn("px-3 py-1.5 text-xs font-medium", view === v.key ? "border-b-2 border-primary" : "text-muted-foreground hover:text-foreground")}>
              {v.label}
            </button>
          ))}
        </div>
        {q.isLoading || !q.data ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            {q.isError ? "Sürümler okunamadı." : <><Loader2 className="h-4 w-4 animate-spin" /> Sürümler çiziliyor…</>}
          </div>
        ) : view === "preview" ? (
          <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-2">
            {[{ v: va, html: q.data.ha }, { v: vb, html: q.data.hb }].map(({ v, html }) => (
              <div key={v?.id} className="flex min-h-[40vh] flex-col">
                <p className="mb-1 text-xs font-medium">v{v?.versionNo}{v?.isPublished ? " · Yayında" : ""}</p>
                <SandboxFrame title={`v${v?.versionNo} önizlemesi`} html={html} className="min-h-0 flex-1" />
              </div>
            ))}
          </div>
        ) : (
          <DiffView label={view === "html" ? "HTML" : "CSS"} oldText={view === "html" ? q.data.a.sourceHtml : q.data.a.css} newText={view === "html" ? q.data.b.sourceHtml : q.data.b.css} />
        )}
      </DialogContent>
    </Dialog>
  );
}
