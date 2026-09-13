// =============================================================================
// DOKUMA İŞİ — yazma mutasyonları (kaydet · kapat · iptal)
// =============================================================================
// ⚠️ `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i zaten basar ve
// backend'in cümlesi (409 açık koşumları ADIYLA söyler) oradan görünür; ikinci
// toast aynı hatayı iki kez okutur (`yerel/mutation-onerror-toast`).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WeavingOrderFormValues } from "./schema";
import { weavingOrderService, type WeavingOrderPayload } from "./service";
import { plannedToIso } from "./types";

export const WEAVING_ORDERS_QUERY_KEY = "weaving-orders";

/** Form METİN taşır; uç sayı/ISO bekler. Boş dize `null`a döner ("0" ≠ "girilmedi"). */
export function buildPayload(v: WeavingOrderFormValues): WeavingOrderPayload {
  const m = (v.plannedM ?? "").trim();
  return {
    itemId: v.itemId,
    colorId: v.colorId || null,
    warpSpecId: v.warpSpecId || null,
    plannedM: m === "" ? null : Number(m),
    executionKind: v.executionKind,
    subcontractorId: v.executionKind === "SUBCONTRACTED" ? v.subcontractorId || null : null,
    plannedStartDate: plannedToIso(v.plannedStartDate),
    plannedEndDate: plannedToIso(v.plannedEndDate),
    notes: (v.notes ?? "").trim() || null,
  };
}

interface SaveInput {
  /** Düzenlemede kayıt id'si; oluşturmada null. */
  id: string | null;
  values: WeavingOrderFormValues;
  clientToken: string;
}

export function useWeavingOrderMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (message: string | undefined, fallback: string) => {
    toast.success(message ?? fallback);
    onDone();
    void qc.invalidateQueries({ queryKey: [WEAVING_ORDERS_QUERY_KEY] });
  };
  const save = useMutation({
    mutationFn: ({ id, values, clientToken }: SaveInput) =>
      id ? weavingOrderService.update(id, buildPayload(values)) : weavingOrderService.create(buildPayload(values), clientToken),
    onSuccess: (res) => settle(res.message, "Kaydedildi."),
  });
  const close = useMutation({
    mutationFn: (id: string) => weavingOrderService.close(id),
    onSuccess: (res) => settle(res.message, "Kapatıldı."),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => weavingOrderService.cancel(id, reason),
    onSuccess: (res) => settle(res.message, "İptal edildi."),
  });
  return { save, close, cancel };
}
