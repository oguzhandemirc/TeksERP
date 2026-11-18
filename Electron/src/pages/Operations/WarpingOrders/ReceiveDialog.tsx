// =============================================================================
// LEVENT KABULÜ — devereciden dönen N levent tek işlemde → `POST /:id/receive` (plan E7, D7a)
// =============================================================================
// İrsaliye no + levent satırları (gövde no · metre · isteğe bağlı brüt/dara). "Önizle" (`POST …/receive/preview`, yazmaz):
// hedef ↔ gelen metre, iplik başına tüketim, devirden kullanılan, etkilenen sevk kalemleri, tartı. Girdi önizlemeden
// sonra değişirse "Kabul et" kapanır. `clientToken` mantıksal deneme başına; sunucu uyarıları interceptor'da BİR KEZ.
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { beamLinesText, fmtM } from "./order-model";
import { buildReceiveBody, draftsFromPlan, type ReceiveBeamDraft } from "./receive-model";
import { warpingReceiveService } from "./receive-service";
import { ReceiveBeamsTable, ReceivePreviewView } from "./ReceiveParts";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingOrder } from "./types";
import type { WarpingReceiveFields, WarpingReceivePreview } from "./receive-types";

function useReceiveDraft(order: WarpingOrder) {
  const [drafts, setDrafts] = useState<ReceiveBeamDraft[]>(() => draftsFromPlan(order.beamLines));
  const [noteNo, setNoteNo] = useState("");
  const built = buildReceiveBody(drafts, noteNo);
  return { drafts, setDrafts, noteNo, setNoteNo, built, body: built.ok ? built.body : null, key: built.ok ? JSON.stringify(built.body) : null };
}

export function ReceiveDialog({ order, onClose }: { order: WarpingOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const d = useReceiveDraft(order);
  const [preview, setPreview] = useState<{ key: string; data: WarpingReceivePreview } | null>(null);
  const pv = useMutation({
    mutationFn: (b: WarpingReceiveFields) => warpingReceiveService.receivePreview(order.id, b),
    onSuccess: (data, b) => setPreview({ key: JSON.stringify(b), data }),
  });
  const save = useMutation({
    mutationFn: (b: WarpingReceiveFields) => warpingReceiveService.receive(order.id, { ...b, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "Leventler kabul edildi.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  const fresh = preview !== null && preview.key === d.key;
  const count = d.body?.beams.length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order.orderNo} — levent kabulü</DialogTitle>
          <DialogDescription>
            {order.subcontractor.name} devereciden dönen leventleri girin (plan {beamLinesText(order.beamLines)}). Adet ve boy plandan farklı olabilir; kullanılan iplik sevk sırasıyla düşülür.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <FormField label="Devereci irsaliye no" htmlFor="wr-note" hint="İsteğe bağlı; kabulün bütün leventlerine yazılır.">
            <Input id="wr-note" maxLength={64} value={d.noteNo} onChange={(e) => d.setNoteNo(e.target.value)} />
          </FormField>
          <ReceiveBeamsTable drafts={d.drafts} onChange={d.setDrafts} />
          {!d.built.ok && d.built.error && <p className="text-destructive">{d.built.error}</p>}
          {fresh && <ReceivePreviewView p={preview.data} />}
          {preview && !fresh && <p className="text-muted-foreground">Girdi değişti — kabul etmeden önce yeniden önizleyin.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" disabled={!d.body || pv.isPending} onClick={() => d.body && pv.mutate(d.body)}>{pv.isPending ? "Önizleniyor…" : "Önizle"}</Button>
          <Button disabled={!fresh || !d.body || save.isPending} onClick={() => d.body && save.mutate(d.body)}>
            {save.isPending ? "Kaydediliyor…" : `Kabul et${d.built.ok ? ` (${count} levent · ${fmtM(d.built.totalM)} m)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
