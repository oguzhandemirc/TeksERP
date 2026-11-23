// H8b: cari formunun "Hizmet faturası" seçimi — fabrika ayarı (null) · her sevkte · dönem sonunda.
// Hizmet faturası kapalıyken gizlenir; seçilmiş bir değer yine de görünmez kalmaz. Yan yana seçenek düğmeleri (2026-11-24).
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { ChoiceChips } from "@/components/ui/toggle-chip";
import { InfoPopover } from "@/components/ui/info-popover";
import type { ServiceBillingTrigger } from "./service";

/** "FACTORY" = fabrika ayarı (gövdede null). */
export type ServiceBillingTriggerChoice = "FACTORY" | ServiceBillingTrigger;

export const SERVICE_BILLING_TRIGGER_CHOICES: Array<{ value: ServiceBillingTriggerChoice; label: string }> = [
  { value: "FACTORY", label: "Fabrika ayarı" },
  { value: "PER_SHIPMENT", label: "Her sevkte" },
  { value: "PERIOD_END", label: "Dönem sonunda" },
];

interface Props {
  /** `null` = alan bu caride yok (fason hesabı / eski backend) → çizilmez. */
  value: ServiceBillingTriggerChoice | null;
  onChange: (v: ServiceBillingTriggerChoice) => void;
  /** Salt-okunur (kart formunda `finance:write` yok). */
  disabled?: boolean;
}

export function CariServiceBillingTriggerField({ value, onChange, disabled = false }: Props) {
  const flags = useFeatureFlags().data?.data;
  if (value === null) return null;
  if (flags?.financeServiceBillingEnabled !== true && value === "FACTORY") return null;
  const factory = flags?.financeServiceBillingTrigger === "PERIOD_END" ? "Dönem sonunda" : "Her sevkte";
  const options = SERVICE_BILLING_TRIGGER_CHOICES.map((c) => (c.value === "FACTORY" ? { ...c, sub: `(${factory})` } : c));
  return (
    <div className="space-y-1.5 sm:col-span-2" data-testid="cari-service-billing-trigger">
      <div className="flex items-center gap-1 text-sm font-medium">
        Hizmet faturası
        <InfoPopover
          label="Hizmet faturası: açıklama"
          desc="Emanet kumaşa yapılan iş bu müşteriye her sevk faturasında ya da Faturalar → “Dönem sonu hizmet faturası” ile ay sonunda kesilir."
        />
      </div>
      <ChoiceChips name="cari-service-billing-trigger" ariaLabel="Hizmet faturası" options={options} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
