import type { LabelCopiesSource } from "@/services/featureFlagService";
import { EnumRadioOptions } from "./EnumRadioOptions";
import { FieldLabel } from "./SettingRow";

/** Backend `DEFAULT_LABEL_COPIES_SOURCE` ile birebir (bekçi `test_label_copies_source` §4b). */
export const DEFAULT_LABEL_COPIES_SOURCE: LabelCopiesSource = "GLOBAL";
/** Backend `readLabelCopies` kayıt-yok değeri. */
export const DEFAULT_LABEL_COPIES = 2;
/** Backend `LABEL_COPIES_MAX` — genel adet, istasyon varsayılanı ve istek aynı tavanı paylaşır. */
export const MAX_LABEL_COPIES = 5;

export function isValidLabelCopies(raw: string): boolean {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_LABEL_COPIES;
}

const SOURCE_OPTIONS = [
  {
    value: "GLOBAL",
    label: "Sistem geneli",
    hint: "Her baskıda aşağıdaki genel adet çıkar; tablette adet seçici görünmez (varsayılan).",
  },
  {
    value: "STATION",
    label: "İstasyon",
    hint: "Tablet her baskıda adedi seçer. Başlangıç değeri istasyon kartındaki “Varsayılan etiket adedi”, boşsa genel adet.",
  },
] as const;

interface Props {
  source: LabelCopiesSource;
  onSourceChange: (v: LabelCopiesSource) => void;
  copies: string;
  onCopiesChange: (v: string) => void;
  disabled?: boolean;
}

/** Etiket adedi: kaynak seçimi + genel adet — Etiket Baskısı kartının ilk bloğu. */
export function LabelCopiesFields({ source, onSourceChange, copies, onCopiesChange, disabled }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel
          label="Etiket adedini kim belirler"
          desc="Top, kartela ve çuval etiketinde bir baskıda kaç kopya çıkacağını kimin belirlediği. Tezgah/levent toplu basımı ve serbest şablon baskısı bu ayardan etkilenmez (orada adet her baskıda seçilir)."
        />
        <div className="mt-2">
          <EnumRadioOptions
            name="label-copies-source"
            value={source}
            options={SOURCE_OPTIONS}
            disabled={disabled}
            onChange={(v) => onSourceChange(v as LabelCopiesSource)}
          />
        </div>
      </div>
      <div>
        <FieldLabel
          htmlFor="label-copies"
          label="Genel etiket adedi"
          desc="Bir top etiketi baskısında kaç kopya çıkar. 2 = etiket topun bir üstüne, bir altına yapıştırılır. “İstasyon” seçiliyken varsayılanı boş bırakılan istasyonlar ve panel baskıları bu değeri kullanır."
        />
        <input
          id="label-copies"
          type="number"
          inputMode="numeric"
          value={copies}
          min={1}
          max={MAX_LABEL_COPIES}
          step={1}
          disabled={disabled}
          onChange={(e) => onCopiesChange(e.target.value)}
          className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {!isValidLabelCopies(copies) && (
          <p className="mt-1 text-xs text-destructive">1–{MAX_LABEL_COPIES} arası bir sayı girin.</p>
        )}
      </div>
    </div>
  );
}
