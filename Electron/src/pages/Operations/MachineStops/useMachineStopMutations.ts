// =============================================================================
// TEZGAH DURUŞU — yazma mutasyonları (aç · kapat · sebep ata · yeniden sınıfla · geri al)
// =============================================================================
// `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i basar (409'lar
// adıyla: STOP_ALREADY_OPEN · STOP_RECLASS_STALE · SHIFT_CANCELLED).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { machineStopService, type OpenStopPayload } from "./service";

export const MACHINE_STOPS_QUERY_KEY = "machine-stops";

export function useMachineStopMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (message: string | undefined, fallback: string) => {
    toast.success(message ?? fallback);
    onDone();
    void qc.invalidateQueries({ queryKey: [MACHINE_STOPS_QUERY_KEY] });
  };
  const open = useMutation({
    mutationFn: (body: OpenStopPayload) => machineStopService.open(body),
    onSuccess: (res) => settle(res.message, res.data.requiresReason ? "Duruş açıldı — sebep borcu doğdu." : "Duruş açıldı."),
  });
  const close = useMutation({
    mutationFn: ({ id, endedAt }: { id: string; endedAt: string | null }) => machineStopService.close(id, endedAt),
    onSuccess: (res) => settle(res.message, "Duruş kapatıldı."),
  });
  const classify = useMutation({
    mutationFn: ({ id, reasonCode, reasonNote }: { id: string; reasonCode: string; reasonNote: string | null }) =>
      machineStopService.classify(id, { reasonCode, reasonNote }),
    onSuccess: (res) => settle(res.message, "Sebep atandı."),
  });
  const reclassify = useMutation({
    mutationFn: ({ id, ...body }: { id: string; fromReasonCode: string; toReasonCode: string; reason: string | null }) =>
      machineStopService.reclassify(id, body),
    onSuccess: (res) => settle(res.message, "Yeniden sınıflandırıldı — defter satırı yazıldı."),
  });
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => machineStopService.revoke(id, reason),
    onSuccess: (res) => settle(res.message, "Duruş geri alındı."),
  });
  return { open, close, classify, reclassify, revoke };
}
