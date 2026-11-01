// D4-V1k: cari kartında KDV / tevkifat — boş = genel ayar (Ayarlar → Muhasebe). Muhasebe faturada satır bazında
// yine değiştirebilir; burası yalnız yeni satış faturası satırının ön değeridir.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { WITHHOLDING_CHOICES, type CariTaxForm } from "./cariTaxOverride";

interface Props {
  /** `null` = alan bu caride yok (eski backend) → çizilmez. */
  value: CariTaxForm | null;
  onChange: (v: CariTaxForm) => void;
  error?: string;
}

export function CariTaxOverrideFields({ value, onChange, error }: Props) {
  const flags = useFeatureFlags().data?.data;
  if (value === null) return null;
  const generalVat = flags?.financeDefaultVatRate ?? 20;
  const generalWh =
    flags?.financeWithholdingEnabled && (flags.financeWithholdingNumerator ?? 0) > 0
      ? `${flags.financeWithholdingNumerator}/${flags.financeWithholdingDenominator ?? 10}`
      : "yok";
  return (
    <fieldset className="col-span-2 rounded-md border p-3" data-testid="cari-tax-override">
      <legend className="px-1 text-xs font-medium">KDV ve tevkifat (satış faturası)</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs" htmlFor="cari-vat-rate">
            KDV oranı (%)
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
        <div>
          <Label className="text-xs" htmlFor="cari-withholding-ratio">
            Tevkifat oranı (pay/payda)
          </Label>
          <Input
            id="cari-withholding-ratio"
            className="mt-1"
            placeholder={`Genel oran (${generalWh})`}
            value={value.ratio}
            onChange={(e) => onChange({ ...value, ratio: e.target.value })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" role="radiogroup" aria-label="Tevkifat">
        <span className="text-xs font-medium">Tevkifat:</span>
        {WITHHOLDING_CHOICES.map((c) => (
          <label key={c.value} className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="cari-withholding"
              value={c.value}
              checked={value.withholding === c.value}
              onChange={() => onChange({ ...value, withholding: c.value })}
            />
            <span className="min-w-0 break-words">{c.value === "FACTORY" ? `${c.label} (${generalWh})` : c.label}</span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        Boş bırakılan alan genel ayardan gelir. Tevkifat KDV üzerinden hesaplanır (5/10: KDV'nin yarısını müşteri öder);
        oranı mali müşavirinizle teyit edin. Faturada satır bazında yine değiştirilebilir.
      </p>
    </fieldset>
  );
}
