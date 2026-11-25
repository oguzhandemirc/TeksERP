// Firma ayarında açık mekanizmalar (K10): kapalı olan YENİ seçimde görünmez; kayıtlı değer (`keep`) kapalı
// olsa da listede kalır (eski kart okunur/kaydedilir). Bayraklar yüklenene dek üçü açık = bugünkü davranış.
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { FeatureFlags } from "@/services/featureFlagService";
import { SHED_MECHANISMS, type ShedMechanism } from "./weave-class";

type MechanismFlags = Pick<FeatureFlags, "dokumaMechanismCamEnabled" | "dokumaMechanismDobbyEnabled" | "dokumaMechanismJacquardEnabled">;

export function enabledMechanisms(flags: Partial<MechanismFlags> | null | undefined): ShedMechanism[] {
  if (!flags) return [...SHED_MECHANISMS];
  const on: Record<ShedMechanism, boolean | undefined> = {
    CAM: flags.dokumaMechanismCamEnabled, DOBBY: flags.dokumaMechanismDobbyEnabled, JACQUARD: flags.dokumaMechanismJacquardEnabled,
  };
  // Eski sunucu alanı göndermez → açık say (sunucu varsayılanı TRUE).
  return SHED_MECHANISMS.filter((m) => on[m] !== false);
}

export function mechanismChoices(enabled: readonly ShedMechanism[], keep?: ShedMechanism): ShedMechanism[] {
  return SHED_MECHANISMS.filter((m) => enabled.includes(m) || m === keep);
}

/** Yeni kartın varsayılan mekanizması: tercih açıksa o, değilse ilk açık olan. */
export function defaultMechanism(enabled: readonly ShedMechanism[], preferred: ShedMechanism = "DOBBY"): ShedMechanism {
  return enabled.includes(preferred) ? preferred : (enabled[0] ?? preferred);
}

export function useEnabledMechanisms(): ShedMechanism[] {
  const q = useFeatureFlags();
  return enabledMechanisms(q.data?.data);
}
