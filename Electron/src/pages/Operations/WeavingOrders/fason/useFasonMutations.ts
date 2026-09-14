import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiResponse } from "@/types/api";
import { WEAVING_ORDERS_QUERY_KEY } from "../useWeavingOrderMutations";
import { fasonWeavingService, type FasonDispatchBody, type FasonReceiptBody } from "./service";

export const FASON_QUERY_KEY = "weaving-fason";

/** Hata toast'ı apiClient interceptor'ında (çift toast yasağı); burada yalnız başarı + `warnings`. */
export function useFasonMutations(weavingOrderId: string, onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: ApiResponse<unknown>, fallback: string) => {
    toast.success(res.message ?? fallback);
    for (const w of res.warnings ?? []) toast.warning(w, { duration: 8000 });
    onDone();
    void qc.invalidateQueries({ queryKey: [FASON_QUERY_KEY, weavingOrderId] });
    void qc.invalidateQueries({ queryKey: [WEAVING_ORDERS_QUERY_KEY] });
  };
  const dispatch = useMutation({
    mutationFn: (body: FasonDispatchBody) => fasonWeavingService.dispatch(body),
    onSuccess: (res) => settle(res, "Sevk açıldı."),
  });
  const cancelDispatch = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fasonWeavingService.cancelDispatch(id, reason),
    onSuccess: (res) => settle(res, "Sevk iptal edildi."),
  });
  const receive = useMutation({
    mutationFn: (body: FasonReceiptBody) => fasonWeavingService.receive(body),
    onSuccess: (res) => settle(res, "Kabul kaydedildi."),
  });
  const cancelReceipt = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fasonWeavingService.cancelReceipt(id, reason),
    onSuccess: (res) => settle(res, "Makbuz iptal edildi."),
  });
  const returnBeam = useMutation({
    mutationFn: ({ dispatchId, warpBeamId, ...body }: { dispatchId: string; warpBeamId: string; lengthM: number; clientToken: string }) =>
      fasonWeavingService.returnBeam(dispatchId, warpBeamId, body),
    onSuccess: (res) => settle(res, "Levent dönüşü kaydedildi."),
  });
  return { dispatch, cancelDispatch, receive, cancelReceipt, returnBeam };
}
