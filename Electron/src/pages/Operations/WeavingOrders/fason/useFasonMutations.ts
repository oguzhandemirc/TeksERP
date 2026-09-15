import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiResponse } from "@/types/api";
import { WEAVING_ORDERS_QUERY_KEY } from "../useWeavingOrderMutations";
import { fasonWeavingService, type FasonDispatchBody, type FasonReceiptBody, type FasonYarnReturnBody } from "./service";

export const FASON_QUERY_KEY = "weaving-fason";

/** Hata toast'ı apiClient interceptor'ında (çift toast yasağı); burada yalnız başarı + `warnings`. */
export function useFasonMutations(weavingOrderId: string, onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: ApiResponse<unknown>, fallback: string) => {
    toast.success(res.message ?? fallback);
    for (const w of res.warnings ?? []) toast.warning(w, { duration: 8000 });
    onDone();
    void qc.invalidateQueries({ queryKey: [FASON_QUERY_KEY, weavingOrderId] });
    void qc.invalidateQueries({ queryKey: [FASON_QUERY_KEY, "yarn-balance"] });
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
  // G1: iplik dönüşü / stornosu — fasoncu bakiyesi de tazelenir (aynı anahtar öneki).
  const returnYarn = useMutation({
    mutationFn: ({ dispatchId, dispatchItemId, ...body }: { dispatchId: string; dispatchItemId: string } & FasonYarnReturnBody) =>
      fasonWeavingService.returnYarn(dispatchId, dispatchItemId, body),
    onSuccess: (res) => settle(res, "İplik dönüşü kaydedildi."),
  });
  const cancelYarnReturn = useMutation({
    mutationFn: ({ dispatchId, dispatchItemId, ...body }: { dispatchId: string; dispatchItemId: string; movementId: string; reason: string }) =>
      fasonWeavingService.cancelYarnReturn(dispatchId, dispatchItemId, body),
    onSuccess: (res) => settle(res, "İplik dönüşü geri alındı."),
  });
  return { dispatch, cancelDispatch, receive, cancelReceipt, returnBeam, returnYarn, cancelYarnReturn };
}
