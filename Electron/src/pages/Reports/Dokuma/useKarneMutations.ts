// =============================================================================
// KARNE — yazma mutasyonları (terim düzelt · mühürle · mühür aç)
// =============================================================================
// `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i adıyla basar
// (409 SHIFT_SEALED · SHIFT_SEAL_RACE · SHIFT_NOT_SEALED). `warnings` BASILIR
// (mühürde P > 100 uyarısı vb.). Başarıda liste ve üç rapor tazelenir.
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toastServerSuccess } from "@/lib/serverNotes";
import { dokumaReportsApi, type ShiftTermsCorrection } from "./service";

export const KARNE_QUERY_KEY = ["reports", "dokuma"] as const;

export function useKarneMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (res: { message?: string; warnings?: string[] }, fallback: string) => {
    toastServerSuccess(res, fallback); // uyarılar genel basımdan (App.tsx MutationCache)
    onDone();
    void qc.invalidateQueries({ queryKey: KARNE_QUERY_KEY });
  };
  const correct = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ShiftTermsCorrection }) => dokumaReportsApi.correctTerms(id, body),
    onSuccess: (res) => settle(res, "Karne terimleri düzeltildi."),
  });
  const seal = useMutation({
    mutationFn: (id: string) => dokumaReportsApi.seal(id),
    onSuccess: (res) => settle(res, "Karne mühürlendi."),
  });
  const unseal = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => dokumaReportsApi.unseal(id, reason),
    onSuccess: (res) => settle(res, "Mühür açıldı."),
  });
  return { correct, seal, unseal, isPending: correct.isPending || seal.isPending || unseal.isPending };
}
