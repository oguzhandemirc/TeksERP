// D4-V1k: cari kartında KDV / tevkifat — boş = genel ayar (Ayarlar → Muhasebe). Muhasebe faturada satır bazında
// yine değiştirebilir; burası yalnız yeni fatura satırının ön değeridir. Satış ve alış (F7) ayrı kümelerdir:
// aynı kart hem müşteri hem fason firma olabilir.
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { WITHHOLDING_CHOICES, type CariPurchaseTaxForm, type CariTaxForm, type WithholdingChoice } from "./cariTaxOverride";

interface Props {
  /** `null` = alan bu caride yok (eski backend) → çizilmez. */
  value: CariTaxForm | null;
  onChange: (v: CariTaxForm) => void;
  error?: string;
}

const ratioLabel = (on: boolean | undefined, num: number | undefined, den: number | undefined): string =>
  on && (num ?? 0) > 0 ? `${num}/${den ?? 10}` : "yok";

export function CariTaxOverrideFields({ value, onChange, error }: Props) {
  const flags = useFeatureFlags().data?.data;
  if (value === null) return null;
  const generalVat = flags?.financeDefaultVatRate ?? 20;
  const generalWh = ratioLabel(flags?.financeWithholdingEnabled, flags?.financeWithholdingNumerator, flags?.financeWithholdingDenominator);
  const generalPurchaseWh = ratioLabel(flags?.financePurchaseWithholdingEnabled, flags?.financePurchaseWithholdingNumerator, flags?.financePurchaseWithholdingDenominator);
  return (
    <fieldset className="col-span-2 rounded-md border p-3" data-testid="cari-tax-override">
      <legend className="px-1 text-xs font-medium">KDV ve tevkifat</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label className="text-xs" htmlFor="cari-vat-rate">
            KDV oranı (%) — satış
          </Label>
          <Input
            id="cari-vat-rate"
            className="mt-1"
            inputMode="decimal"
            placeholder={`Genel ayar (%${generalVat})`}
            value={value.vatRate}
            onChange={(e) => onChange({ ...value, vatRate: e.target.value })}
          />
        </div>
        <RatioInput
          id="cari-withholding-ratio"
          label="Satış tevkifat oranı (pay/payda)"
          general={generalWh}
          value={value.ratio}
          onChange={(ratio) => onChange({ ...value, ratio })}
        />
        {value.purchase && (
          <RatioInput
            id="cari-purchase-withholding-ratio"
            label="Alış tevkifat oranı (pay/payda)"
            general={generalPurchaseWh}
            value={value.purchase.ratio}
            onChange={(ratio) => onChange({ ...value, purchase: { ...(value.purchase as CariPurchaseTaxForm), ratio } })}
          />
        )}
      </div>
      <ChoiceRow
        name="cari-withholding"
        label="Satış tevkifatı"
        hint="Bu müşteriye kestiğimiz satış faturasında. Tevkifat KDV üzerinden hesaplanır (5/10: KDV'nin yarısını müşteri öder)."
        general={generalWh}
        value={value.withholding}
        onChange={(withholding) => onChange({ ...value, withholding })}
      />
      {value.purchase && (
        <ChoiceRow
          name="cari-purchase-withholding"
          label="Alış tevkifatı"
          hint="Bu firma bize fatura kesince (ör. fason iş). Genel alış ayarı yalnız fason firmalara uygulanır; burada seçilen her zaman geçerlidir."
          general={generalPurchaseWh}
          value={value.purchase.withholding}
          onChange={(withholding) => onChange({ ...value, purchase: { ...(value.purchase as CariPurchaseTaxForm), withholding } })}
        />
      )}
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        Boş bırakılan alan genel ayardan gelir; oranı mali müşavirinizle teyit edin. Faturada satır bazında yine değiştirilebilir.
      </p>
    </fieldset>
  );
}

function RatioInput({ id, label, general, value, onChange }: { id: string; label: string; general: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Input id={id} className="mt-1" placeholder={`Genel oran (${general})`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface ChoiceRowProps {
  name: string;
  label: string;
  hint: string;
  general: string;
  value: WithholdingChoice;
  onChange: (v: WithholdingChoice) => void;
}

function ChoiceRow({ name, label, hint, general, value, onChange }: ChoiceRowProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5" role="radiogroup" aria-label={label}>
      <span className="flex items-center gap-1 text-xs font-medium">
        {label}:
        <InfoPopover desc={hint} label={`${label} açıklaması`} />
      </span>
      {WITHHOLDING_CHOICES.map((c) => (
        <label key={c.value} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
          <input type="radio" name={name} value={c.value} checked={value === c.value} onChange={() => onChange(c.value)} />
          <span className="min-w-0 break-words">{c.value === "FACTORY" ? `${c.label} (${general})` : c.label}</span>
        </label>
      ))}
    </div>
  );
}
