// =============================================================================
// YENİ İPLİK SEVKİ — `GET /:id/dispatch-preview` önerisi → satırlar (iplik · depo · lot · kg) → `POST /:id/dispatch`
// =============================================================================
// Öneri = plan brüt − bu siparişe giden net − aynı devereciden devreden bakiye (sunucu hesaplar, panel yalnız gösterir).
// Lot kuralı ve bakiye notları satır içinde; sunucu uyarıları interceptor'da BİR KEZ basılır (formda ikinci toast yok).
// `clientToken` mantıksal deneme başına (`useAttemptToken`): belirsiz hatada yapışır, kesin 4xx'te yenilenir.
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { apiErrorMessage } from "@/services/apiClient";
import { buildDispatchBody, initialDispatchLines, type DispatchLineDraft } from "./dispatch-model";
import { DispatchLinesTable } from "./DispatchLinesTable";
import { DispatchBeamBodies } from "./DispatchBeamBodies";
import type { BeamBody } from "@/pages/BeamBodies/types";
import { fmtKg, parseNum } from "./order-model";
import { loadWarehouseOptions } from "./YarnSourcePickers";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { warpingYarnService } from "./yarn-service";
import type { WarpingOrder } from "./types";
import type { WarpingDispatchBody, WarpingDispatchPreview } from "./yarn-types";

/** Tek bakiyeli depo varsa satıra önceden yazılır (kullanıcı yine değiştirebilir). */
async function withDefaultWarehouses(p: WarpingDispatchPreview): Promise<DispatchLineDraft[]> {
  const lines = initialDispatchLines(p);
  if (!p.stock.known) return lines;
  const opts = await Promise.all(lines.map((l) => loadWarehouseOptions(l.yarnItemId).catch(() => [])));
  return lines.map((l, i) => {
    const o = opts[i]!;
    return o.length === 1 ? { ...l, warehouse: { id: o[0]!.id, label: o[0]!.label, balanceKg: o[0]!.balanceKg } } : l;
  });
}

function MetaFields({ meta, setMeta }: { meta: Meta; setMeta: (m: Meta) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField label="Plaka" htmlFor="wd-plate">
        <Input id="wd-plate" maxLength={32} value={meta.plateNumber} onChange={(e) => setMeta({ ...meta, plateNumber: e.target.value })} />
      </FormField>
      <FormField label="Şoför" htmlFor="wd-driver">
        <Input id="wd-driver" maxLength={100} value={meta.driverName} onChange={(e) => setMeta({ ...meta, driverName: e.target.value })} />
      </FormField>
      <FormField label="Not" htmlFor="wd-notes">
        <Input id="wd-notes" maxLength={500} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
      </FormField>
    </div>
  );
}

interface Meta {
  plateNumber: string;
  driverName: string;
  notes: string;
}

function useDispatchDraft(orderId: string) {
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "dispatch-preview", orderId], queryFn: () => warpingYarnService.dispatchPreview(orderId), staleTime: 0 });
  const [lines, setLines] = useState<DispatchLineDraft[] | null>(null);
  const p = pv.data;
  useEffect(() => {
    if (!p || lines !== null) return;
    let alive = true;
    void withDefaultWarehouses(p).then((l) => alive && setLines(l));
    return () => {
      alive = false;
    };
  }, [p, lines]);
  return { pv, p, lines, setLines };
}

export function YarnDispatchDialog({ order, onClose, onDone }: { order: WarpingOrder; onClose: () => void; onDone: (dispatchId: string) => void }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const { pv, p, lines, setLines } = useDispatchDraft(order.id);
  const [meta, setMeta] = useState<Meta>({ plateNumber: "", driverName: "", notes: "" });
  const [bodies, setBodies] = useState<BeamBody[]>([]);
  const built = p && lines ? buildDispatchBody(lines, p, meta, bodies.map((b) => b.id)) : null;
  const total = (lines ?? []).reduce((s, l) => s + (parseNum(l.qtyKg) ?? 0), 0);
  const save = useMutation({
    mutationFn: (body: Omit<WarpingDispatchBody, "clientToken">) => warpingYarnService.dispatch(order.id, { ...body, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "İplik sevki açıldı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onDone(res.data!.dispatch.id);
    },
    onError: (e) => attempt.onFailure(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{order.orderNo} — devereciye iplik sevki</DialogTitle>
          <DialogDescription>
            Öneri: plandaki fireli ihtiyaç − bu siparişe gönderilmiş net iplik − {order.subcontractor.name} elinde başka kapanmış siparişten kalan aynı iplik. Termin siparişten gelir.
          </DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Öneri hesaplanıyor…</p>}
        {pv.isError && <Callout tone="danger">{apiErrorMessage(pv.error)}</Callout>}
        {p && p.warnings.length > 0 && <Callout tone="warning">{p.warnings.join(" ")}</Callout>}
        {p && !p.stock.known && <Callout tone="muted">İplik stoğu izlenmiyor — depo bakiyesi gösterilemiyor.</Callout>}
        {p && lines && <DispatchLinesTable preview={p} lines={lines} onChange={setLines} />}
        {p && lines && <MetaFields meta={meta} setMeta={setMeta} />}
        {p && lines && <DispatchBeamBodies value={bodies} onChange={setBodies} />}
        {built && !built.ok && <p className="text-sm text-muted-foreground">{built.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!built?.ok || save.isPending} onClick={() => built?.ok && save.mutate(built.body)}>
            {save.isPending ? "Sevk ediliyor…" : `Sevk et (${fmtKg(total)} kg)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
