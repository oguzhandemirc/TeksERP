// =============================================================================
// LEVENT — yazma mutasyonları (planla · düzenle · taslak sil · sar · sarımı iptal et · Faz 3 tezgah bağı)
// =============================================================================
// `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i basar (400 köken XOR · 409 durum ·
// 409 iplik eksi bakiye adıyla). `warnings` basılır.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiResponse } from "@/types/api";
import { warpBeamService, type WarpBeamPlanPayload, type WindPayload } from "./service";
import type { WarpBeam } from "./types";

export const WARP_BEAMS_QUERY_KEY = "warp-beams";

export function useWarpBeamMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: { message?: string; warnings?: string[] }, fallback: string) => {
    toast.success(res.message ?? fallback);
    for (const w of res.warnings ?? []) toast.warning(w, { duration: 8000 });
    onDone();
    void qc.invalidateQueries({ queryKey: [WARP_BEAMS_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["yarn-stock"] });
  };
  const save = useMutation({
    mutationFn: ({ id, body, clientToken }: { id: string | null; body: WarpBeamPlanPayload; clientToken: string }) =>
      id ? warpBeamService.update(id, body) : warpBeamService.create(body, clientToken),
    onSuccess: (res) => settle(res, "Kaydedildi."),
  });
  const deleteDraft = useMutation({ mutationFn: (id: string) => warpBeamService.deleteDraft(id), onSuccess: (res) => settle(res, "Taslak silindi.") });
  const wind = useMutation({ mutationFn: ({ id, body }: { id: string; body: WindPayload }) => warpBeamService.wind(id, body), onSuccess: (res) => settle(res, "Sarıldı.") });
  const cancel = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => warpBeamService.cancel(id, reason), onSuccess: (res) => settle(res, "Sarım iptal edildi.") });
  // Faz 3: tak/sök/tüket/düzelt/bitir/hurda/geri al — gövde diyalogda kurulur, burada tek mutasyon (aynı settle).
  const act = useMutation({ mutationFn: ({ run }: { run: () => Promise<ApiResponse<WarpBeam>>; fallback: string }) => run(), onSuccess: (res, v) => settle(res, v.fallback) });
  return { save, deleteDraft, wind, cancel, act };
}
