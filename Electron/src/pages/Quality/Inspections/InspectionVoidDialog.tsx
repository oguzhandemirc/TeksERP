// İptal — önce önizleme ucu etkilenen kaydı listeler (yıkıcı işlem kuralı); önizleme gelmeden düğme açılmaz.
// İptal satırı silmez: voidedAt damgası + gerekçe.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { inspectionService } from "./service";
import { NOT_ACTIVE_TEXT, PHASE_LABEL, errorCodeOf, numText, reasonOk } from "./inspectionRules";

interface Props { id: string; onOpenChange: (v: boolean) => void; onDone: () => void }

export function InspectionVoidDialog({ id, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["quality-inspections", "void-preview", id], queryFn: () => inspectionService.voidPreview(id) });
  const save = useMutation({
    mutationFn: () => inspectionService.void(id, reason.trim()),
    onSuccess: () => { toast.success("Muayene iptal edildi."); onDone(); },
    onError: (e) => setErr(errorCodeOf(e) === "INSPECTION_NOT_ACTIVE" ? NOT_ACTIVE_TEXT : apiErrorText(e, "İptal edilemedi.")),
  });
  const p = preview.data;
  const ready = !!p && p.active;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Muayeneyi iptal et</DialogTitle>
          <DialogDescription>Muayene silinmez; “İptal” olarak gerekçesiyle saklanır. Top muayenesiz kalır, yeniden girilebilir. Bu işlem geri alınmaz.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <p className="text-sm text-muted-foreground">Etkilenen kayıtlar okunuyor…</p>
          : preview.isError ? <p className="text-sm text-destructive">{apiErrorText(preview.error, "Önizleme alınamadı.")}</p>
          : p && (
            <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="void-preview">
              <p>Top <span className="font-mono">{p.inspection.roll.barcode ?? "—"}</span> · {PHASE_LABEL[p.inspection.phase]} · revizyon {p.inspection.revision}</p>
              <p className="text-muted-foreground">{fmtFactoryDateTime(p.inspection.inspectedAt)} · {p.defectCount} hata · {p.inspection.totalPoints} puan · {numText(p.inspection.pointsPer100M2)} /100 m² · derece {p.inspection.suggestedGradeCode ?? "—"}</p>
              <p>{p.printedDocuments.length === 0 ? "Basılmış muayene raporu yok." : `Basılmış raporlar: ${p.printedDocuments.join(", ")} — donmuş belgeler değişmez.`}</p>
              {!p.active && <p className="text-destructive">{NOT_ACTIVE_TEXT}</p>}
            </div>
          )}
        <div className="space-y-1">
          <Label htmlFor="insp-void-reason">Gerekçe</Label>
          <Textarea id="insp-void-reason" maxLength={1000} placeholder="Ör. yanlış top muayene edildi" value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} />
        </div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ready || !reasonOk(reason) || save.isPending} onClick={() => save.mutate()}>İptal et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
