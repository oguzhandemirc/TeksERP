// Düzelt — eski revizyon atomik claim ile kapanır, yeni revizyon yazılır (backend). Gerekçe ≥ 3 olmadan gönderilmez.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { inspectionService, type InspectionDetail } from "./service";
import { NOT_ACTIVE_TEXT, defectRowsFromDetail, errorCodeOf, reasonOk } from "./inspectionRules";
import { MeasureForm, measurePayload, type MeasureState } from "./MeasureForm";

interface Props { detail: InspectionDetail; onOpenChange: (v: boolean) => void; onDone: (newId: string) => void }

export function InspectionReviseDialog({ detail, onOpenChange, onDone }: Props) {
  const attempt = useAttemptToken();
  const [m, setM] = useState<MeasureState>({
    rows: defectRowsFromDetail(detail),
    length: detail.inspectedLengthM == null ? "" : String(detail.inspectedLengthM),
    width: detail.widthSource === "MANUAL" && detail.widthCm != null ? String(detail.widthCm) : "",
  });
  const [note, setNote] = useState(detail.note ?? "");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const payload = measurePayload(m);
  const save = useMutation({
    mutationFn: () => inspectionService.revise(detail.id, { ...payload!, note: note.trim() || null, reviseReason: reason.trim(), clientToken: attempt.token() }),
    onSuccess: (r) => { attempt.onSuccess(); toast.success(`Muayene düzeltildi (revizyon ${r.revision}).`); onDone(r.id); },
    onError: (e) => { attempt.onFailure(e); setErr(errorCodeOf(e) === "INSPECTION_NOT_ACTIVE" ? NOT_ACTIVE_TEXT : apiErrorText(e, "Düzeltme kaydedilemedi.")); },
  });
  const canSave = payload !== null && reasonOk(reason) && !save.isPending;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Muayeneyi düzelt · <span className="font-mono">{detail.roll.barcode ?? "—"}</span></DialogTitle>
          <DialogDescription>Mevcut revizyon {detail.revision} silinmez; “Düzeltildi” olarak zincirde kalır, yeni revizyon yazılır.</DialogDescription>
        </DialogHeader>
        <MeasureForm rollId={detail.rollId} m={m} onChange={(x) => { setM(x); setErr(null); }} />
        <div className="space-y-1">
          <Label htmlFor="insp-note">Not</Label>
          <Textarea id="insp-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="insp-revise-reason">Düzeltme gerekçesi</Label>
          <Textarea id="insp-revise-reason" maxLength={1000} placeholder="Ör. metre yanlış okunmuş" value={reason} onChange={(e) => setReason(e.target.value)} />
          {!reasonOk(reason) && <p className="text-xs text-muted-foreground">En az 3 karakter.</p>}
        </div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!canSave} onClick={() => save.mutate()}>{save.isPending ? "Kaydediliyor…" : "Düzeltmeyi kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
