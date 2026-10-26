import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAttemptToken } from "@/lib/attemptToken";
import { documentTemplateService, type CopyFrom, type CreateTemplateResult } from "@/services/documentTemplateService";
import { docTypeLabel } from "../useDesignerDraft";
import { readTemplateError, templateErrorText } from "./model";

export interface CopyRequest {
  docType: string;
  copyFrom: CopyFrom;
  /** Kaynağın adı (öneri adın tabanı). */
  sourceName: string;
}

export const DESIGNER_EDITOR_PATH = (id: string) => `/definitions/document-designer/${id}`;

const titleOf = (r: CopyRequest) =>
  r.copyFrom.kind === "blank" ? "Boş şablonla başla" : r.copyFrom.kind === "system" ? "Sistem tasarımını kopyala ve düzenle" : "Şablonu kopyala";

/**
 * "Kopyala ve düzenle" (plan P-d): ad sorulur → `POST /`. Token mantıksal deneme başına;
 * yalnız belirsiz hatada yapışır. Dönüş uyarıları (dil `tr`, iç kolon → internalFields) gösterilir.
 */
export function CopyTemplateDialog({ request, onClose }: { request: CopyRequest | null; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [name, setName] = useState("");
  const [done, setDone] = useState<CreateTemplateResult | null>(null);

  useEffect(() => {
    if (!request) return;
    setName(request.copyFrom.kind === "blank" ? `${docTypeLabel(request.docType)} tasarımı` : `${request.sourceName} kopyası`);
    setDone(null);
    attempt.renew();
  }, [request, attempt]);

  const create = useMutation({
    mutationFn: () => documentTemplateService.create({ docType: request!.docType, name: name.trim(), copyFrom: request!.copyFrom, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      void qc.invalidateQueries({ queryKey: ["document-templates"] });
      if (res.data.warnings.length) setDone(res.data);
      else void navigate(DESIGNER_EDITOR_PATH(res.data.template.id));
    },
    onError: (e) => attempt.onFailure(e),
  });

  const err = create.error ? templateErrorText(readTemplateError(create.error), "Şablon oluşturulamadı.") : null;
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Şablon oluşturuldu" : request ? titleOf(request) : ""}</DialogTitle>
          <DialogDescription>{request ? docTypeLabel(request.docType) : ""}</DialogDescription>
        </DialogHeader>
        {done ? (
          <Callout tone="warning" title="Kopyalarken yapılan dönüşümler">
            <ul className="list-disc space-y-1 pl-4" data-testid="kopya-uyarilari">
              {done.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </Callout>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="sablon-adi">Şablon adı</Label>
            <Input id="sablon-adi" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button onClick={() => navigate(DESIGNER_EDITOR_PATH(done.template.id))}>Editöre geç</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Vazgeç</Button>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Oluştur ve düzenle
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
