// İptal — önce önizleme ucu etkilenen testi ve sonuçlarını listeler (yıkıcı işlem kuralı), gerekçe zorunlu.
// İptal ileri kaydı silmez: test VOIDED olur, onay damgası korunur.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/api-error";
import { labTestService } from "./service";
import { resultValueText } from "./labTestRules";

interface Props { testId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }

export function LabVoidDialog({ testId, open, onOpenChange, onDone }: Props) {
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: ["lab-tests", "void-preview", testId], queryFn: () => labTestService.voidPreview(testId), enabled: open });
  const save = useMutation({
    mutationFn: () => labTestService.void(testId, reason.trim()),
    onSuccess: (t) => { toast.success(`${t.testNo} iptal edildi.`); onOpenChange(false); onDone(); },
  });
  const p = preview.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lab testini iptal et</DialogTitle>
          <DialogDescription>Test silinmez; “İptal” durumuna geçer ve gerekçesiyle saklanır. Bu işlem geri alınmaz.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <p className="text-sm text-muted-foreground">Etkilenen kayıtlar okunuyor…</p>
          : preview.isError ? <p className="text-sm text-destructive">{apiErrorText(preview.error, "Önizleme alınamadı.")}</p>
          : p && (
            <div className="space-y-2 text-sm">
              <p><span className="font-mono">{p.test.testNo}</span>{p.wasApproved ? " — onaylı test; onay bilgisi korunur." : " — taslak test."}</p>
              <div className="max-h-48 overflow-auto rounded-md border">
                {p.test.results.length === 0 ? <p className="p-3 text-muted-foreground">Sonuç yok.</p> : p.test.results.map((r) => (
                  <div key={r.id} className="flex justify-between border-b px-3 py-1.5 last:border-0"><span>{r.testType.name}</span><span className="tabular-nums">{resultValueText(r)}</span></div>
                ))}
              </div>
            </div>
          )}
        <div className="space-y-1">
          <Label htmlFor="lab-void-reason">Gerekçe</Label>
          <Textarea id="lab-void-reason" maxLength={500} placeholder="Ör. numune karıştı" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>İptal et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
