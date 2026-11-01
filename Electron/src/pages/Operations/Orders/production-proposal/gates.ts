// SY-M3: siparişten üretim önerisi + tezgâh önerisi yüzeylerinin TEK kapısı. Ayar `siparis.uretimOnerisi`
// KAPALI (varsayılan) iken hiçbir yüzey çizilmez ve istek atılmaz — bugünkü ekran bayt-aynı kalır.
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { FeatureFlags } from "@/services/featureFlagService";

export type ProposalMode = FeatureFlags["orderProductionProposal"];

type GateFlags = Pick<Partial<FeatureFlags>, "orderProductionProposal" | "productionEnabled" | "dokumaEnabled"> | undefined;

/** Yüklenmemiş/eski sunucu = KAPALI (fail-closed: bilinmeyen değer de kapalı sayılır). */
export function proposalModeOf(flags: GateFlags): ProposalMode {
  const m = flags?.orderProductionProposal;
  return m === "ONIZLEME" || m === "ONAYDA_TASLAK" ? m : "KAPALI";
}

/** "Üretime gönder" düğmesi: ayar açık ∧ üretim modülü ∧ en az bir tür için yazma izni. */
export function proposalButtonVisible(flags: GateFlags, canWriteAny: boolean): boolean {
  return proposalModeOf(flags) !== "KAPALI" && flags?.productionEnabled === true && canWriteAny;
}

/** Tezgâh önerisi (form bölümü · liste kolonu · Salon rozeti): ayar açık ∧ dokuma modülü ∧ `weavingorder:read`. */
export function loomSuggestionVisible(flags: GateFlags, canReadWeaving: boolean): boolean {
  return proposalModeOf(flags) !== "KAPALI" && flags?.productionEnabled === true && flags?.dokumaEnabled === true && canReadWeaving;
}

export function useProposalGates() {
  const flags = useFeatureFlags().data?.data;
  const { hasPermission } = useRoleAccess();
  return {
    mode: proposalModeOf(flags),
    buttonVisible: proposalButtonVisible(flags, hasPermission("weavingorder:write") || hasPermission("workorder:write")),
    loomSuggestionVisible: loomSuggestionVisible(flags, hasPermission("weavingorder:read")),
  };
}

/** ONAYDA_TASLAK: yeni (doğuşta onaylı) siparişte önizleme kendiliğinden açılır; diğer kiplerde açılmaz. */
export function opensProposalOnApprove(mode: ProposalMode, buttonVisible: boolean, order: { id?: string; status?: string } | null | undefined): boolean {
  return mode === "ONAYDA_TASLAK" && buttonVisible && Boolean(order?.id) && (order?.status === "APPROVED" || order?.status === "PARTIAL_SHIPPED");
}
