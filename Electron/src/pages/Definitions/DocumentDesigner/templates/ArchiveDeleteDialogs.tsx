import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { documentTemplateService, type DocumentTemplateRow } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";
import { assignmentLines, readTemplateError, templateErrorText } from "./model";

const invalidate = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ["document-templates"] });

/** Arşiv: atanmış şablonda sunucu 409 + atama listesi döner; liste burada gösterilir (canlı referanslı pasife alınamaz). */
export function ArchiveDialog({ template, onClose }: { template: DocumentTemplateRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => documentTemplateService.archive(template!.id),
    onSuccess: () => {
      toast.success("Şablon arşivlendi.");
      invalidate(qc);
      onClose();
    },
  });
  const err = archive.error ? readTemplateError(archive.error) : null;
  const lines = err ? assignmentLines(err.details, docTypeLabel) : [];
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && (archive.reset(), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>"{template?.name}" arşivlensin mi?</DialogTitle>
          <DialogDescription>Arşivlenen şablon atanamaz ve yayınlanamaz; sürümleri ve basılmış belgelerin atfı korunur. Arşivden geri çıkarılabilir.</DialogDescription>
        </DialogHeader>
        {err && (
          <Callout tone="danger" title={templateErrorText(err, "Arşivlenemedi.")}>
            {lines.length > 0 && <ul className="list-disc pl-4 text-xs" data-testid="arsiv-atamalari">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          </Callout>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={archive.isPending || !!err} onClick={() => archive.mutate()}>
            {archive.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Arşivle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Silme: önce `delete-preview` (etkilenen her sürüm listelenir); yalnız hiç yayınlanmamış, atanmamış taslak silinir. */
export function DeleteDialog({ template, onClose }: { template: DocumentTemplateRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ["document-templates", "delete-preview", template?.id], enabled: !!template, queryFn: () => documentTemplateService.deletePreview(template!.id) });
  const remove = useMutation({
    mutationFn: () => documentTemplateService.remove(template!.id),
    onSuccess: () => {
      toast.success("Taslak şablon silindi.");
      invalidate(qc);
      onClose();
    },
  });
  const p = preview.data?.data;
  const err = remove.error ? templateErrorText(readTemplateError(remove.error), "Silinemedi.") : null;
  return (
    <Dialog open={!!template} onOpenChange={(o) => !o && (remove.reset(), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>"{template?.name}" silinsin mi?</DialogTitle>
          <DialogDescription>Silme yalnız hiç yayınlanmamış taslakta yapılır ve geri alınamaz; aşağıdaki sürümlerin hepsi silinir.</DialogDescription>
        </DialogHeader>
        {preview.isLoading || !p ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Silme önizlemesi alınıyor…</p>
        ) : (
          <div className="space-y-2 text-sm" data-testid="silme-onizlemesi">
            <ul className="max-h-32 overflow-y-auto text-xs">
              {p.versions.map((v) => <li key={v.id}>v{v.versionNo} · {fmtFactoryDateTime(v.createdAt)}{v.publishedAt ? " · yayınlandı" : ""}</li>)}
            </ul>
            {p.reason && <Callout tone="warning" title="Silinemez">{p.reason}</Callout>}
            {p.assignments.length > 0 && <ul className="list-disc pl-4 text-xs">{assignmentLines({ atamalar: p.assignments }, docTypeLabel).map((l) => <li key={l}>{l}</li>)}</ul>}
          </div>
        )}
        {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p?.deletable || remove.isPending} title={p?.reason ?? undefined} onClick={() => remove.mutate()}>
            {remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Kalıcı sil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
