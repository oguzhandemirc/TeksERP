// =============================================================================
// TEZGAH DURUŞU — yazma mutasyonları (aç · kapat · sebep ata · yeniden sınıfla · geri al)
// =============================================================================
// `onError`da toast YOK (sınıfla/yeniden sınıfla/geri al): `apiClient` interceptor'ı 4xx/5xx'i basar
// (409'lar adıyla: STOP_ALREADY_OPEN · STOP_RECLASS_STALE · SHIFT_CANCELLED). İSTİSNA aç/kapat:
// genel toast bastırılır — aralık dışı damga (400 `STOP_STAMP_OUT_OF_RANGE`, 7 gün geri / 5 dk ileri,
// 6e 3781d60d) diyalogda ALAN hatasıdır; diğer hataları bu hook toast'lar.
// ⚠️ `warnings` BASILIR: sunucu aralık dışı `startedAt`/`endedAt`i (36 sa geri / 5 dk
// ileri) SUNUCU SAATİNE kırpar ve bunu warnings ile söyler — susulursa amir 3 gün
// önceki başlangıcı yazar, kayıt ŞİMDİ olarak açılır ve ekran "açıldı" der (47 H1).
// =============================================================================
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastServerSuccess } from "@/lib/serverNotes";
import type { AxiosError } from "axios";
import { machineStopService, type OpenStopPayload } from "./service";

export const MACHINE_STOPS_QUERY_KEY = "machine-stops";

export const STAMP_RANGE_CODE = "STOP_STAMP_OUT_OF_RANGE";
interface ErrBody {
  message?: string;
  details?: { code?: string };
}
/** Aralık dışı damga → alan hatası (mesajı sunucudan: "en çok 7 gün geriye, 5 dakika ileriye"); diğer hatalar toast. */
function stampErrorOrToast(e: unknown, setStamp: (m: string) => void): void {
  const body = (e as AxiosError<ErrBody>)?.response?.data;
  if (body?.details?.code === STAMP_RANGE_CODE) return setStamp(body.message ?? "Beyan edilen an kabul aralığının dışında.");
  toast.error(body?.message ?? "İşlem başarısız oldu.");
}

export function useMachineStopMutations(onDone: () => void) {
  const qc = useQueryClient();
  const [stampError, setStampError] = useState<string | null>(null);
  const settle = (res: { message?: string; warnings?: string[] }, fallback: string) => {
    toastServerSuccess(res, fallback); // uyarılar apiClient interceptor'ında genel basılır
    setStampError(null);
    onDone();
    void qc.invalidateQueries({ queryKey: [MACHINE_STOPS_QUERY_KEY] });
  };
  const open = useMutation({
    mutationFn: (body: OpenStopPayload) => machineStopService.open(body),
    onSuccess: (res) => settle(res, res.data.requiresReason ? "Duruş açıldı — sebep borcu doğdu." : "Duruş açıldı."),
    onError: (e) => stampErrorOrToast(e, setStampError),
  });
  const close = useMutation({
    mutationFn: ({ id, endedAt }: { id: string; endedAt: string | null }) => machineStopService.close(id, endedAt),
    onSuccess: (res) => settle(res, "Duruş kapatıldı."),
    onError: (e) => stampErrorOrToast(e, setStampError),
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
  return { open, close, classify, reclassify, revoke, stampError, clearStampError: () => setStampError(null) };
}
