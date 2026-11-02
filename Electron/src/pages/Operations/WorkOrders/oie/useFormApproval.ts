// Gelen belge ayarı `formApproval` (K7): eski backend alanı göndermez ya da modül kapalı → SEPARATE (bugünkü ayrı onay).
import { useQuery } from "@tanstack/react-query";
import { useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { getIncomingDocumentSettings, INCOMING_DOCUMENT_SETTINGS_QUERY_KEY } from "@/pages/Operations/GelenBelgeler/service";
import type { FormApproval } from "./docDraft";

export function useFormApproval(): { value: FormApproval; isLoading: boolean } {
  const enabled = useGelenBelgeEnabled();
  const q = useQuery({ queryKey: INCOMING_DOCUMENT_SETTINGS_QUERY_KEY, queryFn: getIncomingDocumentSettings, enabled, staleTime: 60_000 });
  return { value: q.data?.formApproval === "WITH_WORK_ORDER" ? "WITH_WORK_ORDER" : "SEPARATE", isLoading: enabled && q.isLoading };
}
