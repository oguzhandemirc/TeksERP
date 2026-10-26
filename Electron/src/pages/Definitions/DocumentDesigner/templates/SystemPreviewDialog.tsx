import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { documentTemplateService } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";
import { SandboxFrame } from "./SandboxFrame";

/** Backend `AppError` sözleşmesi: kod `details.code`ta (`body.code` hep boş). */
const apiErrorCode = (e: unknown): string | null =>
  ((e as { response?: { data?: { details?: { code?: unknown } } } })?.response?.data?.details?.code as string | undefined) ?? null;

export const NO_EQUIVALENT_TEXT = "Bu belge türü için kopyalanabilir tasarım henüz yok.";

/** Sistem şablonunun önizlemesi: yerleşik çıktı örnek veriyle; yoksa eşleniği (eşitlik bekçisiyle kilitli) ilk senaryoyla. */
export function SystemPreviewDialog({ docType, onClose }: { docType: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["document-templates", "system-preview", docType],
    enabled: !!docType,
    queryFn: async () => {
      // Önce yerleşik renderer (eşleniği olmayan türde de çizer); 409'da eşlenik + senaryo yoluna düşülür.
      try {
        const r = await documentTemplateService.systemPreview(docType!);
        return { html: r.data.html, senaryo: "örnek veri" };
      } catch (e) {
        if (apiErrorCode(e) !== "NO_SYSTEM_PREVIEW") throw e;
      }
      const [sys, contract] = await Promise.all([documentTemplateService.system(docType!), documentTemplateService.contract(docType!)]);
      const eq = sys.data.equivalent;
      const senaryo = contract.data.senaryolar[0]?.ad;
      if (!eq || !senaryo) return { html: null, senaryo: null };
      const r = await documentTemplateService.preview({
        docType: docType!,
        source: { editMode: eq.editMode, sourceHtml: eq.html, css: eq.css, pageSettings: eq.pageSettings, settings: sys.data.settings, internalFields: sys.data.internalFields },
        sample: { kind: "senaryo", key: senaryo },
      });
      return { html: r.data.html, senaryo };
    },
  });
  return (
    <Dialog open={!!docType} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Sistem tasarımı — {docType ? docTypeLabel(docType) : ""}</DialogTitle>
          <DialogDescription>
            Salt-okunur. {q.data?.senaryo ? `Örnek: ${q.data.senaryo}.` : ""} Değiştirmek için "Kopyala ve düzenle".
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-muted/40 p-2">
          {q.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Önizleme hazırlanıyor…</div>
          ) : q.data?.html ? (
            <SandboxFrame title="Sistem tasarımı önizlemesi" html={q.data.html} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{q.isError ? "Önizleme alınamadı." : NO_EQUIVALENT_TEXT}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
