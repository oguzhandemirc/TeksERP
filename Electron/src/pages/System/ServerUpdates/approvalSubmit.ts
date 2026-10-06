import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { serverUpdateService } from "@/services/serverUpdateService";
import type { UpdateApprovalChoice } from "@/types/server-update";
import { SERVER_UPDATE_KEY } from "./hooks";

/**
 * Güncelleme kararını backend'e yazar — ONAY KARTI ve ONAY İSTEMİ aynı yolu kullanır (tek token/toast kuralı).
 * Token mantıksal deneme başına bir kez doğar; belirsiz hatada (ağ/5xx) yapışır, kesin 4xx'te yenilenir.
 * Başarıda `onDone` çağrılır; hata toast'ı çağıran pencereyi AÇIK bırakır (yeniden deneme aynı pencereden).
 */
export function useApprovalSubmit(kind: UpdateApprovalChoice, surum: string, doneText: string, onDone: () => void): () => Promise<void> {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  return async () => {
    try {
      const r = await serverUpdateService.approve({ clientToken: attempt.token(), surum, zamanlama: kind });
      attempt.onSuccess();
      onDone();
      if (r.niyet.yazildi) toast.success(doneText);
      else toast.warning(`Karar kaydedildi ama güncelleyiciye henüz iletilemedi (${r.niyet.kod ?? "bilinmiyor"}); bir sonraki yoklamada yeniden denenir.`);
    } catch (err) {
      attempt.onFailure(err);
      toast.error(apiErrorText(err, "Güncelleme kararı kaydedilemedi."));
    } finally {
      await qc.invalidateQueries({ queryKey: SERVER_UPDATE_KEY });
    }
  };
}
