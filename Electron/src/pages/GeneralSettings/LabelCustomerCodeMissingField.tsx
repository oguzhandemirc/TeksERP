import type { LabelCustomerCodeMissing } from "@/services/featureFlagService";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { FieldLabel } from "./SettingRow";

/** Backend `DEFAULT_LABEL_CUSTOMER_CODE_MISSING` ile birebir (bekçi `LabelCustomerCodeMissingField.test`). */
export const DEFAULT_LABEL_CUSTOMER_CODE_MISSING: LabelCustomerCodeMissing = "BLOCK";

export const CUSTOMER_CODE_MISSING_OPTIONS = [
  {
    value: "BLOCK",
    label: "Etiket basılmasın (varsayılan)",
    hint: "Topa müşteri barkodu bağlanmadan basılamaz; operatör önce müşteri etiketini okutup bağlar.",
  },
  {
    value: "ROLL_BARCODE",
    label: "Bizim top barkodu basılsın",
    hint: "Müşteri barkodunun yerine iç top barkodu basılır ve ekranda uyarı çıkar.",
  },
] as const;

interface Props {
  value: LabelCustomerCodeMissing;
  onChange: (v: LabelCustomerCodeMissing) => void;
  disabled?: boolean;
}

/** D4-F3: müşteri barkodu basan şablonda top kodsuzsa ne olur (`label.customerCodeMissing`). */
export function LabelCustomerCodeMissingField({ value, onChange, disabled }: Props) {
  return (
    <div>
      <FieldLabel
        label="Müşteri barkodu yoksa"
        desc="Yalnız barkodu ya da karekodu “Müşteri barkodu” basacak şekilde tasarlanmış etiket şablonlarında geçerlidir (Etiket şablonu → barkod elemanı → Kaynak). Diğer şablonlar bu ayardan etkilenmez."
      />
      <div className="mt-2">
        <EnumRadioOptions
          name="label-customer-code-missing"
          value={value}
          options={CUSTOMER_CODE_MISSING_OPTIONS}
          disabled={disabled}
          onChange={(v) => onChange(v as LabelCustomerCodeMissing)}
        />
      </div>
    </div>
  );
}
