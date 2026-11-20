// İade belgesi oluştur — tek sahip, seçili boş gövdeler, plaka/şoför/not. Belge no sunucuda doğar (LGI-YYMM-NNNN).
// `clientToken` mantıksal deneme başına; oluşunca belge önizlemesi/basımı açılır.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldGrid } from "@/components/forms/WideFormDialog";
import { FormField } from "@/components/forms/FormField";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { BEAM_BODIES_QUERY_KEY, BEAM_BODY_RETURNS_QUERY_KEY, beamBodyReturnService } from "../service";
import type { BeamBody, BeamBodyReturnDoc, CodedRef } from "../types";
import { ReturnDocDialog } from "./ReturnDocDialog";

export function ReturnCreateDialog({ owner, bodies, onClose, onDone }: { owner: CodedRef; bodies: BeamBody[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [meta, setMeta] = useState({ plateNumber: "", driverName: "", notes: "" });
  const [created, setCreated] = useState<BeamBodyReturnDoc | null>(null);
  const save = useMutation({
    mutationFn: () =>
      beamBodyReturnService.create(
        { ownerCustomerId: owner.id, bodyIds: bodies.map((b) => b.id), plateNumber: meta.plateNumber.trim() || null, driverName: meta.driverName.trim() || null, notes: meta.notes.trim() || null },
        attempt.token(),
      ),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "İade belgesi oluşturuldu.");
      void qc.invalidateQueries({ queryKey: [BEAM_BODIES_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: [BEAM_BODY_RETURNS_QUERY_KEY] });
      if (res.data) setCreated(res.data);
      else onDone();
    },
    onError: (e) => attempt.onFailure(e),
  });
  if (created) return <ReturnDocDialog docId={created.id} initial={created} onClose={onDone} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{owner.name} — gövde iade belgesi</DialogTitle>
          <DialogDescription>{bodies.length} boş gövde sahibine teslim edilir. Belge iptal edilirse gövdeler yeniden “Depoda boş” olur.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
            {bodies.map((b) => (
              <span key={b.id} className="rounded-badge bg-muted px-1.5 py-0.5 font-mono text-xs">{b.bodyNo}</span>
            ))}
          </div>
          <FieldGrid cols={3}>
            <FormField label="Plaka" htmlFor="bbr-plate">
              <Input id="bbr-plate" maxLength={32} value={meta.plateNumber} onChange={(e) => setMeta({ ...meta, plateNumber: e.target.value })} />
            </FormField>
            <FormField label="Şoför" htmlFor="bbr-driver">
              <Input id="bbr-driver" maxLength={100} value={meta.driverName} onChange={(e) => setMeta({ ...meta, driverName: e.target.value })} />
            </FormField>
            <FormField label="Not" htmlFor="bbr-notes">
              <Input id="bbr-notes" maxLength={500} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
            </FormField>
          </FieldGrid>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={bodies.length === 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Oluşturuluyor…" : `Belgeyi oluştur (${bodies.length} gövde)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
