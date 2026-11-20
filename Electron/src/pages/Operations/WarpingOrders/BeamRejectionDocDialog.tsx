// Ret belgesi görünümü — iframe önizleme = baskı (`printTracked` tek boğaz; B2 iade belgesi emsali) + fotoğraflar +
// iptal (önizlemeli: sarım başına engel, tutmadan yeniden düşecek iplik ve tutanın bugünkü tutması).
import { useEffect, useRef, useState } from "react";
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
import { fmtKg } from "./order-model";
import { buildRejectionHtml } from "./rejection-html";
import { warpingRejectionService } from "./rejection-service";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingBeamRejection } from "./rejection-types";

function PhotoThumb({ docId, photo }: { docId: string; photo: WarpingBeamRejection["photos"][number] }) {
  const q = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "rejection-photo", photo.id], queryFn: () => warpingRejectionService.photoBlob(docId, photo.id), staleTime: Infinity });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return undefined;
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  return (
    <li className="h-20 w-20 overflow-hidden rounded-md border bg-muted" title={photo.fileName}>
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={photo.fileName} className="h-full w-full object-cover" /></a> : null}
    </li>
  );
}

export function BeamRejectionDocDialog({ docId, initial, autoPrint, onClose }: { docId: string; initial?: WarpingBeamRejection; autoPrint?: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "rejection", docId], queryFn: () => warpingRejectionService.get(docId), initialData: initial, staleTime: 0 });
  const [cancelling, setCancelling] = useState(false);
  const printedRef = useRef(false);
  const d = q.data;
  const html = d ? buildRejectionHtml(d) : null;
  const print = () => d && html && void printTracked({ subject: { kind: "BELGE", no: d.docNo, itemCount: d.items.length }, html });
  // "Gönder ve belge bas": ret yeni açıldıysa baskı penceresi BİR KEZ kendiliğinden gelir.
  useEffect(() => {
    if (!autoPrint || printedRef.current || !d || !html) return;
    printedRef.current = true;
    void printTracked({ subject: { kind: "BELGE", no: d.docNo, itemCount: d.items.length }, html });
  }, [autoPrint, d, html]);
  if (d && cancelling) return <CancelRejectionDialog doc={d} onClose={() => setCancelling(false)} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{d ? `${d.docNo} — ${d.subcontractor.name}` : "Ret belgesi"}</DialogTitle>
          <DialogDescription>Kusurlu leventle birlikte devereciye giden belge. İki nüsha basıp imzalatın.</DialogDescription>
        </DialogHeader>
        {d && d.photos.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Ret fotoğrafları">{d.photos.map((p) => <PhotoThumb key={p.id} docId={d.id} photo={p} />)}</ul>}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
          {q.isError && <p role="alert" className="p-4 text-sm text-destructive">{apiErrorMessage(q.error)}</p>}
          {html && <iframe title="Ret belgesi önizleme" srcDoc={html} sandbox="allow-same-origin allow-modals" className="h-full w-full border-0 bg-white" />}
        </div>
        <DialogFooter>
          {d?.status === "ACTIVE" && (
            <PermissionGate permission="warping-order:cancel">
              <Button variant="outline" className="mr-auto text-destructive" onClick={() => setCancelling(true)}>
                <Ban className="mr-1 h-4 w-4" /> Reddi iptal et
              </Button>
            </PermissionGate>
          )}
          <Button variant="outline" onClick={onClose}>Kapat</Button>
          <Button className="gap-1" disabled={!html} onClick={print}><Printer className="h-4 w-4" /> Yazdır</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelRejectionDialog({ doc, onClose }: { doc: WarpingBeamRejection; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "rejection-cancel-preview", doc.id], queryFn: () => warpingRejectionService.cancelPreview(doc.id), retry: false, staleTime: 0 });
  const m = useMutation({
    mutationFn: () => warpingRejectionService.cancel(doc.id, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, `${doc.docNo} iptal edildi.`);
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{doc.docNo} — reddi iptal et</DialogTitle>
          <DialogDescription>Belge silinmez, iptal damgası alır; sarımlar ters kayıtla yeniden “Hazır” olur ve iplikleri deverecinin bakiyesinden yeniden düşer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {pv.isLoading && <p className="text-muted-foreground">Önizleme hazırlanıyor…</p>}
          {pv.isError && <Callout tone="danger">{apiErrorMessage(pv.error)}</Callout>}
          {p && (
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" aria-label="Etkilenen sarımlar">
              {p.items.map((it) => (
                <li key={it.beamId} className="px-3 py-1.5"><b>{it.beamNo}</b>{it.blocker ? <span className="text-destructive"> — {it.blocker}</span> : <span className="text-muted-foreground"> → Hazır</span>}</li>
              ))}
              {p.yarn.map((y) => (
                <li key={`${y.dispatchItemId}|${y.holderWarpingOrderId}`} className={y.enough ? "px-3 py-1.5 text-muted-foreground" : "px-3 py-1.5 text-destructive"}>
                  {y.name || y.code} — {fmtKg(y.kg)} kg {y.dispatchNo} ({y.holderOrderNo}) tutmasından düşer · tutma {fmtKg(y.holdingKg)} kg
                </li>
              ))}
            </ul>
          )}
          {p && p.blockers.length > 0 && <Callout tone="warning"><ul className="list-disc pl-4">{p.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul></Callout>}
          {p?.cancellable && (
            <FormField label="İptal sebebi" required htmlFor="brj-cancel-reason">
              <Textarea id="brj-cancel-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="En az 3 karakter" />
            </FormField>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p?.cancellable || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "İptal ediliyor…" : "Reddi iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
