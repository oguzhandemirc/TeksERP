// =============================================================================
// TEZGAH DURUŞU — yazma mutasyonları (aç · kapat · sebep ata · yeniden sınıfla · geri al)
// =============================================================================
// `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i basar (409'lar
// adıyla: STOP_ALREADY_OPEN · STOP_RECLASS_STALE · SHIFT_CANCELLED).
// ⚠️ `warnings` BASILIR: sunucu aralık dışı `startedAt`/`endedAt`i (36 sa geri / 5 dk
// ileri) SUNUCU SAATİNE kırpar ve bunu warnings ile söyler — susulursa amir 3 gün
// önceki başlangıcı yazar, kayıt ŞİMDİ olarak açılır ve ekran "açıldı" der (47 H1).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { machineStopService, type OpenStopPayload } from "./service";

export const MACHINE_STOPS_QUERY_KEY = "machine-stops";

export function useMachineStopMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: { message?: string; warnings?: string[] }, fallback: string) => {
    toast.success(res.message ?? fallback);
    for (const w of res.warnings ?? []) toast.warning(w, { duration: 8000 });
    onDone();
    void qc.invalidateQueries({ queryKey: [MACHINE_STOPS_QUERY_KEY] });
  };
  const open = useMutation({
    mutationFn: (body: OpenStopPayload) => machineStopService.open(body),
    onSuccess: (res) => settle(res, res.data.requiresReason ? "Duruş açıldı — sebep borcu doğdu." : "Duruş açıldı."),
  });
  const close = useMutation({
    mutationFn: ({ id, endedAt }: { id: string; endedAt: string | null }) => machineStopService.close(id, endedAt),
    onSuccess: (res) => settle(res, "Duruş kapatıldı."),
  });
  const classify = useMutation({
    mutationFn: ({ id, reasonCode, reasonNote }: { id: string; reasonCode: string; reasonNote: string | null }) =>
      machineStopService.classify(id, { reasonCode, reasonNote }),
    onSuccess: (res) => settle(res, "Sebep atandı."),
  });
  const reclassify = useMutation({
    mutationFn: ({ id, ...body }: { id: string; fromReasonCode: string; toReasonCode: string; reason: string | null }) =>
      machineStopService.reclassify(id, body),
    onSuccess: (res) => settle(res, "Yeniden sınıflandırıldı — defter satırı yazıldı."),
  });
  const revoke = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => machineStopService.revoke(id, reason),
    onSuccess: (res) => settle(res, "Duruş geri alındı."),
  });
  return { open, close, classify, reclassify, revoke };
}
