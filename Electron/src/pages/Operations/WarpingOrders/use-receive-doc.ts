// Dönüş kabul belgesi diyaloğunun durumu (devere ek E2): devereci · irsaliye no · sipariş başı satır taslakları,
// deverecinin açık siparişleri (sunucu süzer), önizleme tazeliği ve kabul (token mantıksal deneme başına).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDevereBeamBodyMode, useDevereDuplicateDeliveryNote, useDevereReceiveWeighing } from "@/hooks/usePricingEnabled";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import { buildReceiveDocBody, deliveryNoteUsesOf, type DocOrderDraft } from "./receive-doc-model";
import { useDeliveryNoteGroup, WARPING_RECEIVE_DOCS_QUERY_KEY, warpingReceiveDocService } from "./receive-doc-service";
import { draftsFromPlan, type ReceiveBeamDraft } from "./receive-model";
import { listWarpingOrders, WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingOrder, WarpingOrderRow } from "./types";
import type { WarpingReceiveDoc, WarpingReceiveDocFields, WarpingReceiveDocPreview } from "./receive-doc-types";

export const OPEN_ORDER_LIMIT = 100;

const rowOf = (o: WarpingOrder): WarpingOrderRow => ({
  id: o.id, orderNo: o.orderNo, status: o.status, warpSpec: o.warpSpec, subcontractor: { id: o.subcontractor.id, name: o.subcontractor.name },
  beamCount: o.beamCount, beamCountOpen: o.beamCountOpen, targetLengthM: o.targetLengthM, expectedReturnAt: o.expectedReturnAt, createdAt: o.createdAt,
});

/** Deverecinin kabul alabilen (açık + sevkte) siparişleri — süzme sunucuda. */
export function useOpenOrders(subcontractorId: string | null) {
  return useQuery({
    queryKey: [WARPING_ORDERS_QUERY_KEY, "receivable", subcontractorId],
    queryFn: () => listWarpingOrders({ limit: OPEN_ORDER_LIMIT, filters: { status: ["OPEN", "IN_PROGRESS"], subcontractorId: subcontractorId as string } }),
    enabled: Boolean(subcontractorId),
    staleTime: 10_000,
  });
}

export function useReceiveDoc(fixedOrder: WarpingOrder | undefined, onDone: (doc: WarpingReceiveDoc) => void) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const weighing = useDevereReceiveWeighing();
  const bodyMode = useDevereBeamBodyMode();
  const dupMode = useDevereDuplicateDeliveryNote();
  const [sub, setSubState] = useState<{ id: string; name: string } | null>(fixedOrder ? { id: fixedOrder.subcontractor.id, name: fixedOrder.subcontractor.name } : null);
  const [noteNo, setNoteNo] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ReceiveBeamDraft[]>>(() => (fixedOrder ? { [fixedOrder.id]: draftsFromPlan(fixedOrder.beamLines) } : {}));
  const orders = useOpenOrders(sub?.id ?? null);
  const fetched: WarpingOrderRow[] = orders.data?.data ?? [];
  // Sipariş sayfasından açılınca o sipariş liste gelmeden de kartıyla durur (liste yalnız diğerlerini ekler).
  const rows: WarpingOrderRow[] = fixedOrder ? [rowOf(fixedOrder), ...fetched.filter((r) => r.id !== fixedOrder.id)] : fetched;
  const debouncedNote = useDebouncedValue(noteNo, 400);
  const group = useDeliveryNoteGroup(sub?.id ?? null, debouncedNote, dupMode !== "ALLOW");
  const priorUses = dupMode === "ALLOW" ? [] : deliveryNoteUsesOf(group.data);

  const setSub = (v: { id: string; name: string } | null) => {
    setSubState(v);
    setDrafts({});
  };
  const docOrders: DocOrderDraft[] = rows.map((r) => ({ orderId: r.id, orderNo: r.orderNo, drafts: drafts[r.id] ?? [] }));
  const built = buildReceiveDocBody(docOrders, { subcontractorId: sub?.id ?? null, deliveryNoteNo: noteNo, weighing });
  const body = built.ok ? built.body : null;
  const key = body ? JSON.stringify(body) : null;

  const [preview, setPreview] = useState<{ key: string; data: WarpingReceiveDocPreview } | null>(null);
  const pv = useMutation({
    mutationFn: (b: WarpingReceiveDocFields) => warpingReceiveDocService.preview(b),
    onSuccess: (data, b) => setPreview({ key: JSON.stringify(b), data }),
  });
  const save = useMutation({
    mutationFn: (b: WarpingReceiveDocFields) => warpingReceiveDocService.create({ ...b, clientToken: attempt.token() }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toastServerSuccess(res, "Leventler kabul edildi.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: [WARPING_RECEIVE_DOCS_QUERY_KEY] });
      if (res.data) onDone(res.data);
    },
    onError: (e) => attempt.onFailure(e),
  });
  const fresh = preview !== null && preview.key === key;
  // BLOCK'ta önizleme engeli uyarı olarak döner; kabul 409 verir — düğmeyi baştan kapatırız.
  const blocked = dupMode === "BLOCK" && fresh && preview.data.deliveryNoteUses.length > 0;
  return {
    weighing, bodyMode, dupMode, sub, setSub, noteNo, setNoteNo, drafts, setOrderDrafts: (id: string, d: ReceiveBeamDraft[]) => setDrafts((s) => ({ ...s, [id]: d })),
    orders, rows, priorUses, built, body, preview, fresh, blocked, pv, save,
  };
}
