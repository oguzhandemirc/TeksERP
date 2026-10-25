// İptal — önce önizleme ucu etkilenen sertifikayı ve eklerini listeler (yıkıcı işlem kuralı), gerekçe zorunlu.
// İptal kaydı silmez: sertifika "İptal" olur, belgeleri saklanır.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { fmtCalendarDay } from "@/lib/factory-time";
import { certificateService } from "./service";
import { fileSizeText } from "./certificateRules";

interface Props { certificateId: string; onOpenChange: (v: boolean) => void; onDone: () => void }

export function CertificateRevokeDialog({ certificateId, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: ["certificates", "revoke-preview", certificateId], queryFn: () => certificateService.revokePreview(certificateId) });
  const save = useMutation({
    mutationFn: () => certificateService.revoke(certificateId, reason.trim()),
    onSuccess: (c) => { toast.success(`${c.certificateNo} iptal edildi.`); onOpenChange(false); onDone(); },
  });
  const p = preview.data;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sertifikayı iptal et</DialogTitle>
          <DialogDescription>Sertifika silinmez; “İptal” durumuna geçer, gerekçesi ve belgeleriyle saklanır. Süre uyarısı kapanır.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <p className="text-sm text-muted-foreground">Etkilenen kayıtlar okunuyor…</p>
          : preview.isError ? <p className="text-sm text-destructive">{apiErrorText(preview.error, "Önizleme alınamadı.")}</p>
          : p && (
            <div className="space-y-2 text-sm">
              <p><span className="font-medium">{p.certificate.standard}</span> · <span className="font-mono">{p.certificate.certificateNo}</span> — bitiş {fmtCalendarDay(p.certificate.expiresOn)}</p>
              <div className="max-h-48 overflow-auto rounded-md border">
                {p.certificate.files.length === 0 ? <p className="p-3 text-muted-foreground">Ekli belge yok.</p> : p.certificate.files.map((f) => (
                  <div key={f.id} className="flex justify-between gap-3 border-b px-3 py-1.5 last:border-0"><span className="truncate">{f.fileName}</span><span className="tabular-nums text-muted-foreground">{fileSizeText(f.sizeBytes)}</span></div>
                ))}
              </div>
            </div>
          )}
        <div className="space-y-1">
          <Label htmlFor="cert-revoke-reason">Gerekçe</Label>
          <Textarea id="cert-revoke-reason" maxLength={500} placeholder="Ör. kuruluş sertifikayı askıya aldı" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>İptal et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
