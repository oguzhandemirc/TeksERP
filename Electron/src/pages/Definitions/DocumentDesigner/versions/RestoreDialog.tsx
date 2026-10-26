import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAttemptToken } from "@/lib/attemptToken";
import { documentTemplateService, type DocumentTemplateRow, type SaveVersionResult, type TemplateVersionSummary } from "@/services/documentTemplateService";
import { readTemplateError, templateErrorText } from "../templates/model";

export interface RestoreTarget {
  template: DocumentTemplateRow;
  version: TemplateVersionSummary;
  /** Şu anki son sürüm — yeni sürümün tabanı (bayatsa 409). */
  latest: TemplateVersionSummary;
}

/** Geri alma metni: ileri kayıt ne silinir ne değişir; yalnız yeni sürüm açılır. */
export function restoreExplanation(t: RestoreTarget): string {
  return `v${t.version.versionNo} içeriğiyle yeni bir sürüm (v${t.latest.versionNo + 1}) açılır. v${t.version.versionNo}–v${t.latest.versionNo} arası sürümler silinmez; yayındaki sürüm değişmez — yeni sürümü ayrıca yayınlarsınız.`;
}

/** "Bu sürümden taslak" (geri alma): eski içerik → YENİ değişmez sürüm. */
export function RestoreDialog({ target, onClose, onRestored }: { target: RestoreTarget | null; onClose: () => void; onRestored?: (r: SaveVersionResult) => void }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!target) return;
    setNote(`v${target.version.versionNo} sürümünden geri alındı`);
    attempt.renew();
  }, [target, attempt]);

  const restore = useMutation({
    mutationFn: async () => {
      const { template, version, latest } = target!;
      const v = (await documentTemplateService.version(template.id, version.id)).data;
      return documentTemplateService.saveVersion(template.id, {
        baseVersionId: latest.id,
        editMode: v.editMode,
        sourceHtml: v.sourceHtml,
        css: v.css,
        pageSettings: v.pageSettings ?? {},
        settings: v.settings ?? {},
        internalFields: Array.isArray(v.internalFields) ? v.internalFields : [],
        tableBindings: v.tableBindings ?? {},
        note: note.trim() || null,
        clientToken: attempt.token(),
      });
    },
    onSuccess: (r) => {
      attempt.onSuccess();
      if (r.data.created) toast.success(`v${r.data.version.versionNo} taslak olarak açıldı.`);
      else toast.info("İçerik son sürümle aynı; yeni sürüm açılmadı.");
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
      onRestored?.(r.data);
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  const err = restore.error ? templateErrorText(readTemplateError(restore.error), "Geri alınamadı.") : null;
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && (restore.reset(), onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>v{target?.version.versionNo} sürümünden taslak</DialogTitle>
          <DialogDescription data-testid="geri-alma-aciklamasi">{target ? restoreExplanation(target) : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="geri-alma-notu">Sürüm notu</Label>
          <Input id="geri-alma-notu" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={restore.isPending} onClick={() => restore.mutate()}>
            {restore.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Yeni sürüm aç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
