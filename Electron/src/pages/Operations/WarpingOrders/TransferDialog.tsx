// =============================================================================
// BAŞKA SİPARİŞE AKTAR — deverecideki ipliği AYNI deverecinin başka siparişine (stok hareketi YOK) (D6b-2)
// =============================================================================
// Hedef modal seçiciyle → tutma satırı başına kg → "Önizle" (`POST …/yarn-transfers/preview`, yazmaz; etkilenen
// her kalem listelenir) → "Aktar" (`POST …/yarn-transfers`). Girdi önizlemeden sonra değişirse Aktar kapanır.
// `clientToken` mantıksal deneme başına; sunucu uyarıları interceptor'da BİR KEZ basılır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { buildTransferLines, initialTransferDrafts, type TransferDraftRow, type YarnNames } from "./holding-model";
import { warpingHoldingService } from "./holding-service";
import { fmtKg } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { TargetOrderPicker, type TargetOrderRef } from "./TargetOrderPicker";
import { TransferDraftTable, TransferPreviewList } from "./TransferParts";
import type { WarpingOrder } from "./types";
import type { WarpingTransferFields, WarpingTransferPreview, WarpingYarnHolding } from "./holding-types";

function useTransferDraft(holdings: WarpingYarnHolding[]) {
  const [target, setTarget] = useState<TargetOrderRef | null>(null);
  const [drafts, setDrafts] = useState<TransferDraftRow[]>(() => initialTransferDrafts(holdings));
  const [note, setNote] = useState("");
  const built = buildTransferLines(drafts);
  const body: WarpingTransferFields | null = target && built.ok ? { toWarpingOrderId: target.id, lines: built.lines, note: note.trim() || null } : null;
  return { target, setTarget, drafts, setDrafts, note, setNote, built, body, key: body ? JSON.stringify(body) : null };
}

interface Props {
  order: WarpingOrder;
  holdings: WarpingYarnHolding[];
  names: YarnNames;
  onClose: () => void;
}

export function TransferDialog({ order, holdings, names, onClose }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const d = useTransferDraft(holdings);
  const [preview, setPreview] = useState<{ key: string; data: WarpingTransferPreview } | null>(null);
  const pv = useMutation({
    mutationFn: (b: WarpingTransferFields) => warpingHoldingService.transferPreview(order.id, b),
    onSuccess: (data, b) => setPreview({ key: JSON.stringify(b), data }),
  });
  const save = useMutation({
    mutationFn: (b: WarpingTransferFields) => warpingHoldingService.transfer(order.id, { ...b, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "Aktarma kaydedildi.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  const fresh = preview !== null && preview.key === d.key;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{order.orderNo} — başka siparişe aktar</DialogTitle>
          <DialogDescription>İplik deverecide kalır, stok hareketi yazılmaz; yalnız hangi siparişe sayıldığı değişir. Hedef aynı devereciye ({order.subcontractor.name}) ait olmalı.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <FormField label="Hedef sipariş" required>
            <TargetOrderPicker sourceId={order.id} subcontractorId={order.subcontractor.id} value={d.target} onChange={d.setTarget} />
          </FormField>
          <TransferDraftTable drafts={d.drafts} names={names} onChange={d.setDrafts} />
          <FormField label="Not" htmlFor="wt-note">
            <Input id="wt-note" maxLength={300} value={d.note} onChange={(e) => d.setNote(e.target.value)} />
          </FormField>
          {!d.built.ok && d.drafts.some((r) => r.qtyKg.trim() !== "") && <p className="text-destructive">{d.built.error}</p>}
          {fresh && d.target && <TransferPreviewList p={preview.data} names={names} targetNo={d.target.orderNo} />}
          {preview && !fresh && <p className="text-muted-foreground">Girdi değişti — aktarmadan önce yeniden önizleyin.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="outline" disabled={!d.body || pv.isPending} onClick={() => d.body && pv.mutate(d.body)}>{pv.isPending ? "Önizleniyor…" : "Önizle"}</Button>
          <Button disabled={!fresh || !d.body || save.isPending} onClick={() => d.body && save.mutate(d.body)}>
            {save.isPending ? "Aktarılıyor…" : `Aktar${d.built.ok ? ` (${fmtKg(d.built.totalKg)} kg)` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
