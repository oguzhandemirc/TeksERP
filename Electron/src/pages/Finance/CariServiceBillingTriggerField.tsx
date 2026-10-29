// H8b: cari formunun "Hizmet faturası" seçimi — fabrika ayarı (null) · her sevkte · dönem sonunda.
// Hizmet faturası kapalıyken gizlenir; seçilmiş bir değer yine de görünmez kalmaz.
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
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
}

export function CariServiceBillingTriggerField({ value, onChange }: Props) {
  const flags = useFeatureFlags().data?.data;
  if (value === null) return null;
  if (flags?.financeServiceBillingEnabled !== true && value === "FACTORY") return null;
  const factory = flags?.financeServiceBillingTrigger === "PERIOD_END" ? "Dönem sonunda" : "Her sevkte";
  return (
    <fieldset className="col-span-2 rounded-md border p-3" data-testid="cari-service-billing-trigger">
      <legend className="px-1 text-xs font-medium">Hizmet faturası</legend>
      <div className="grid grid-cols-1 gap-1.5">
        {SERVICE_BILLING_TRIGGER_CHOICES.map((c) => (
          <label key={c.value} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="cari-service-billing-trigger"
              value={c.value}
              checked={value === c.value}
              onChange={() => onChange(c.value)}
            />
            <span className="min-w-0 break-words">{c.value === "FACTORY" ? `${c.label} (${factory})` : c.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Emanet kumaşa yapılan iş bu müşteriye her sevk faturasında ya da Faturalar → “Dönem sonu hizmet faturası” ile
        ay sonunda kesilir.
      </p>
    </fieldset>
  );
}
