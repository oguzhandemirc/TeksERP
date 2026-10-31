// D4-I2b (S12): cari kartındaki risk limiti alanının yanında ölçüm kipi ipucu — limit para birimi taşımaz,
// kullanıcı limitin hangi rakamla karşılaştırıldığını alanın yanında görmeli (ayar: Fabrika Ayarları → Kasa & Risk).
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import type { FeatureFlags } from "@/services/featureFlagService";

export type RiskLimitCurrencyMode = FeatureFlags["financeRiskLimitCurrencyMode"];

/** Kip metni; ayar okunamazsa (eski backend) varsayılan kip — bugünkü davranış. */
export function riskLimitModeHintText(mode: RiskLimitCurrencyMode | undefined): string {
  return mode === "TRY_CONVERTED"
    ? "Limit TL'dir: carinin tüm bakiyeleri o güne kadarki en son kurla TL'ye çevrilip toplanır (kur yoksa işlem durur)."
    : "Limit her para biriminde ayrı ölçülür (TL, USD, EUR bakiyesi ayrı ayrı).";
}

export function RiskLimitModeHint({ className = "mt-1 text-xs text-muted-foreground" }: { className?: string }) {
  const mode = useFeatureFlags().data?.data?.financeRiskLimitCurrencyMode;
  return (
    <p className={className} data-testid="risk-limit-mode-hint">
      {riskLimitModeHintText(mode)}
    </p>
  );
}
