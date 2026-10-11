// =============================================================================
// TEZGAH ALARMI — kişi eylemleri (üstlen · bırak · sustur · not · geri çek)
// =============================================================================
// `clientToken` MANTIKSAL DENEME başına bir kez (`useAttemptToken`): eylem başına bir deneme, parametreli
// eylemde (`keyed`) parametre başına ayrı alt token; yalnız belirsiz hatada (ağ · zaman aşımı · 5xx) yapışır, kesin 4xx'te ve
// başarıda düşer. Her sonuçta (başarı ya da 403/409) alarm sorguları tazelenir — sunucu
// "başkası üstlendi / kapandı" diyorsa ekran o hâli göstermeli.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import type { ApiResponse } from "@/types/api";
import { loomAlarmService } from "./service";
import type { LoomAlarmActionResult, SnoozeMinutes } from "./types";

export const LOOM_ALARMS_QUERY_ROOT = "loom-alarms";

/** Backend cümlesi (alan hataları önce); yanıt yoksa bağlantı cümlesi. */
export function actionErrorMessage(error: unknown): string {
  const e = error as { response?: { status?: number; data?: { message?: string; errors?: { message: string }[] } } } | null;
  const body = e?.response?.data;
  if (body?.errors && body.errors.length > 0) return body.errors.map((x) => x.message).join(" • ");
  if (body?.message) return body.message;
  if (!e?.response) return "Sunucuya ulaşılamadı — tekrar deneyin (aynı işlem iki kez yazılmaz).";
  return "İşlem yapılamadı.";
}

type Call<P> = (param: P, token: string) => Promise<ApiResponse<LoomAlarmActionResult>>;

/** Tek eylem = tek `useAttemptToken` denemesi; `keyOf` verilirse parametre başına alt token (`keyed`). */
function useAlarmCall<P>(call: Call<P>, pendingKeyOf: (param: P) => string, keyed: boolean) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const refresh = () => void qc.invalidateQueries({ queryKey: [LOOM_ALARMS_QUERY_ROOT] });
  const m = useMutation({
    mutationFn: async (param: P) => {
      const token = keyed ? attempt.keyed(pendingKeyOf(param)) : attempt.token();
      try {
        const res = await call(param, token);
        attempt.onSuccess();
        return res;
      } catch (error) {
        attempt.onFailure(error);
        throw error;
      }
    },
    onSuccess: (res) => {
      toast.success(res.message || "Kaydedildi.");
      refresh();
    },
    onError: (error) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- eylem istekleri `suppressErrorToast` taşır (service.ts `post`): 403/409 kodları yetki sorunu değil, cümle backend'den TEK toast
      toast.error(actionErrorMessage(error));
      refresh();
    },
  });
  return {
    run: (param: P) => m.mutateAsync(param).catch(() => undefined),
    isPending: m.isPending,
    pendingKey: m.isPending ? pendingKeyOf(m.variables as P) : null,
  };
}

export function useLoomAlarmActions(alarmId: string) {
  const ack = useAlarmCall<void>((_, t) => loomAlarmService.ack(alarmId, t), () => "ack", false);
  const release = useAlarmCall<void>((_, t) => loomAlarmService.release(alarmId, t), () => "release", false);
  const snooze = useAlarmCall<SnoozeMinutes>((min, t) => loomAlarmService.snooze(alarmId, min, t), (min) => `snooze:${min}`, true);
  const unsnooze = useAlarmCall<void>((_, t) => loomAlarmService.unsnooze(alarmId, t), () => "unsnooze", false);
  const note = useAlarmCall<string>((text, t) => loomAlarmService.note(alarmId, text, t), () => "note", false);
  const retract = useAlarmCall<string>((eventId, t) => loomAlarmService.retractNote(alarmId, eventId, t), (id) => `retract:${id}`, true);
  const all = [ack, release, snooze, unsnooze, note, retract];
  return {
    isPending: all.some((x) => x.isPending),
    pendingKey: all.find((x) => x.pendingKey !== null)?.pendingKey ?? null,
    ack: () => ack.run(),
    release: () => release.run(),
    snooze: (minutes: SnoozeMinutes) => snooze.run(minutes),
    unsnooze: () => unsnooze.run(),
    note: (text: string) => note.run(text),
    retractNote: (eventId: string) => retract.run(eventId),
  };
}

export type LoomAlarmActions = ReturnType<typeof useLoomAlarmActions>;
