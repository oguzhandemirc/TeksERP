// D4-I2b (S12): cari kartındaki risk limiti alanının yanında ölçüm kipi + (D4-KUC3a) engel ipucu — limit para birimi taşımaz,
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

type RiskBlockFlags = Partial<Pick<FeatureFlags, "financeRiskLimitBlockEnabled" | "financeRiskLimitBlockIntake" | "financeRiskLimitBlockShipment">>;

/** D4-KUC3a: limitin GERÇEK etkisi (D4-I2/I2b sonrası "yalnız uyarıdır" metni bayattı) — üç engel ayarından okunur;
 *  ayar okunamazsa (eski backend) üçü de kapalı sayılır = bugünkü varsayılan. */
export function riskLimitEnforcementText(flags: RiskBlockFlags | undefined): string {
  const blocked = [
    flags?.financeRiskLimitBlockEnabled ? "satış faturası onayı" : null,
    flags?.financeRiskLimitBlockIntake ? "yeni iş kabulü (gelen belge onayı, sipariş)" : null,
    flags?.financeRiskLimitBlockShipment ? "sevk (tamamı müşterinin kendi emaneti olan sevk hariç)" : null,
  ].filter((x): x is string => x !== null);
  if (blocked.length === 0) {
    return "Limit aşılınca yalnız uyarı verilir; satış, iş kabulü ve sevk durmaz (Fabrika Ayarları → Kasa & Risk).";
  }
  return `Limit aşılınca durdurulur: ${blocked.join("; ")}. Diğer işlemlerde yalnız uyarı verilir (Fabrika Ayarları → Kasa & Risk).`;
}

export function RiskLimitModeHint({ className = "mt-1 text-xs text-muted-foreground" }: { className?: string }) {
  const flags = useFeatureFlags().data?.data;
  return (
    <>
      <p className={className} data-testid="risk-limit-enforcement-hint">
        {riskLimitEnforcementText(flags)}
      </p>
      <p className={className} data-testid="risk-limit-mode-hint">
        {riskLimitModeHintText(flags?.financeRiskLimitCurrencyMode)}
      </p>
    </>
  );
}
