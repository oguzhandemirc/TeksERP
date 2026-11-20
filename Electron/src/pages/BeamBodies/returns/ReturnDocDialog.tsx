// İade belgesi görünümü — iframe önizleme = baskı (`printTracked` tek boğaz) + iptal (önizlemeli: gövde başına engel).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { printTracked } from "@/lib/print";
import { toastServerSuccess } from "@/lib/serverNotes";
import { apiErrorMessage } from "@/services/apiClient";
import { BEAM_BODIES_QUERY_KEY, BEAM_BODY_RETURNS_QUERY_KEY, beamBodyReturnService } from "../service";
import type { BeamBodyReturnDoc } from "../types";
import { buildReturnHtml } from "./return-html";

export function ReturnDocDialog({ docId, initial, onClose }: { docId: string; initial?: BeamBodyReturnDoc; onClose: () => void }) {
  const q = useQuery({ queryKey: [BEAM_BODY_RETURNS_QUERY_KEY, "detail", docId], queryFn: () => beamBodyReturnService.get(docId), initialData: initial, staleTime: 0 });
  const [cancelling, setCancelling] = useState(false);
  const d = q.data;
  const html = d ? buildReturnHtml(d) : null;
  if (d && cancelling) return <CancelReturnDialog doc={d} onClose={() => setCancelling(false)} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{d ? `${d.docNo} — ${d.owner.name}` : "İade belgesi"}</DialogTitle>
          <DialogDescription>Boş levent gövdelerinin sahibine teslim belgesi. İki nüsha basıp imzalatın.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {q.isError && <p role="alert" className="p-4 text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
          {html && <iframe title="İade belgesi önizleme" srcDoc={html} sandbox="allow-same-origin allow-modals" className="h-full w-full border-0 bg-white" />}
        </div>
        <DialogFooter>
          {d?.status === "ACTIVE" && (
            <PermissionGate permission="beam-body:write">
              <Button variant="outline" className="mr-auto text-destructive" onClick={() => setCancelling(true)}>
                <Ban className="mr-1 h-4 w-4" /> Belgeyi iptal et
              </Button>
            </PermissionGate>
          )}
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button className="gap-1" disabled={!html} onClick={() => d && html && void printTracked({ subject: { kind: "BELGE", no: d.docNo, itemCount: d.items.length }, html })}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelReturnDialog({ doc, onClose }: { doc: BeamBodyReturnDoc; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const pv = useQuery({ queryKey: [BEAM_BODY_RETURNS_QUERY_KEY, "cancel-preview", doc.id], queryFn: () => beamBodyReturnService.cancelPreview(doc.id), retry: false, staleTime: 0 });
  const m = useMutation({
    mutationFn: () => beamBodyReturnService.cancel(doc.id, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, `${doc.docNo} iptal edildi.`);
      void qc.invalidateQueries({ queryKey: [BEAM_BODY_RETURNS_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: [BEAM_BODIES_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{doc.docNo} — iade belgesini iptal et</DialogTitle>
          <DialogDescription>Belge silinmez, iptal damgası alır; gövdeler ters kayıtla yeniden “Depoda boş” olur. Yalnız gövdeler iadeden sonra başka hareket görmediyse.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {pv.isLoading && <p className="text-sm text-muted-foreground">Önizleme hazırlanıyor…</p>}
          {pv.isError && <Callout tone="danger">{apiErrorMessage(pv.error)}</Callout>}
          {p && (
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm" aria-label="Etkilenen gövdeler">
              {p.items.map((it) => (
                <li key={it.bodyId} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-28 font-mono">{it.bodyNo}</span>
                  <span className="flex-1 text-muted-foreground">{it.currentStatusLabel}</span>
                  {it.blocker && <span className="text-xs text-destructive">{it.blocker}</span>}
                </li>
              ))}
            </ul>
          )}
          {p?.blocker && <Callout tone="warning">{p.blocker}</Callout>}
          {p?.cancellable && (
            <FormField label="İptal sebebi" required htmlFor="bbr-cancel-reason">
              <Textarea id="bbr-cancel-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="En az 3 karakter" />
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p?.cancellable || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "İptal ediliyor…" : "Belgeyi iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
