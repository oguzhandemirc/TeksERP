// =============================================================================
// ALARM SORUMLULARI — yazma eylemleri (ekle · kaldır)
// =============================================================================
// `clientToken` MANTIKSAL DENEME başına bir kez (`useAttemptToken`): deneme = aynı gövde, alt token gövde
// anahtarıyla (`keyed`) doğar; yalnız belirsiz hatada yapışır, kesin 4xx'te ve başarıda düşer. Kaldırma
// token taşımaz (atomik claim; ikinci tıklama 409).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { toastServerSuccess } from "@/lib/serverNotes";
import type { ApiResponse } from "@/types/api";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { loomAlarmDutyService, type DutyKind } from "./service";
import type { OverrideBody, ResponsibleBody, RuleBody } from "./types";

export const LOOM_ALARM_DUTY_QUERY_ROOT = "loom-alarm-duty";

// Sunucu uyarısı (alarmı göremeyen kişi) apiClient interceptor'ında GENEL basılır (`serverNotes.ts`).
const report = (res: ApiResponse<unknown>) => toastServerSuccess(res, "Kaydedildi.");

function useDutyCreate<B>(call: (body: B, token: string) => Promise<ApiResponse<unknown>>) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const m = useMutation({
    mutationFn: async (body: B) => {
      const token = attempt.keyed(JSON.stringify(body));
      try {
        const res = await call(body, token);
        attempt.onSuccess();
        return res;
      } catch (error) {
        attempt.onFailure(error);
        throw error;
      }
    },
    onSuccess: report,
    onError: (error) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır (service.ts): 400/409 cümlesi backend'den TEK toast
      toast.error(actionErrorMessage(error));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT] }),
  });
  return { run: (body: B) => m.mutateAsync(body).then(() => true, () => false), isPending: m.isPending };
}

function useDutyRevoke() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ kind, id }: { kind: DutyKind; id: string }) => loomAlarmDutyService.revoke(kind, id),
    onSuccess: (res) => toastServerSuccess(res, "Kaldırıldı."),
    onError: (error) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır (service.ts): 404/409 cümlesi backend'den TEK toast
      toast.error(actionErrorMessage(error));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [LOOM_ALARM_DUTY_QUERY_ROOT] }),
  });
  return { run: (kind: DutyKind, id: string) => m.mutateAsync({ kind, id }).then(() => true, () => false), isPending: m.isPending };
}

export function useDutyActions() {
  const responsible = useDutyCreate<ResponsibleBody>((b, t) => loomAlarmDutyService.createResponsible(b, t));
  const override = useDutyCreate<OverrideBody>((b, t) => loomAlarmDutyService.createOverride(b, t));
  const rule = useDutyCreate<RuleBody>((b, t) => loomAlarmDutyService.createRule(b, t));
  const revoke = useDutyRevoke();
  return {
    isPending: responsible.isPending || override.isPending || rule.isPending || revoke.isPending,
    addResponsible: responsible.run,
    addOverride: override.run,
    addRule: rule.run,
    revoke: revoke.run,
  };
}

export type DutyActions = ReturnType<typeof useDutyActions>;
