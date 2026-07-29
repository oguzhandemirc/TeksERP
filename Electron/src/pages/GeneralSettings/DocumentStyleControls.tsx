import type { DocumentConfig, DocStyleConfig } from "@/services/documentConfig";
import { FlagToggle } from "./SettingRow";

// =============================================================================
// Belge görünüm (stil) kontrolleri — DocumentConfigSection'ın alt paneli.
// Sayfa boyutu / kenar boşluğu / yazı ölçeği-kalınlığı / tablo yoğunluk-stili
// + logo bas/konum. Ham (kısmi) config'e patch atar; çözüm backend renderer'da.
// =============================================================================

const FONT_SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4] as const;

export function DocumentStyleControls({
  cfg,
  disabled,
  patch,
}: {
  /** Seçili belgenin HAM config'i (taslak). */
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const style = cfg?.style ?? {};
  const patchStyle = (next: Partial<DocStyleConfig>) =>
    patch({ style: { ...style, ...next } });

  // Tek "kenar boşluğu" alanı — dört kenara aynı değer (boş → belge varsayılanı).
  const marginValue = style.margins?.top ?? "";

  return (
    <div className="rounded-md border p-3">
      <div className="pb-2 text-sm font-medium">Görünüm</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Sayfa boyutu"
          value={style.pageSize ?? "A4"}
          disabled={disabled}
          options={[
            { value: "A4", label: "A4" },
            { value: "A5", label: "A5" },
          ]}
          onChange={(v) => patchStyle({ pageSize: v === "A5" ? "A5" : "A4" })}
        />
        <div>
          <label className="text-xs text-muted-foreground">Kenar boşluğu (mm)</label>
          <input
            type="number"
            min={0}
            max={40}
            value={marginValue}
            placeholder="varsayılan"
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                patchStyle({ margins: undefined });
                return;
              }
              const n = Math.min(40, Math.max(0, Number(raw)));
              patchStyle({ margins: { top: n, right: n, bottom: n, left: n } });
            }}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <SelectField
          label="Yazı ölçeği"
          value={String(style.fontScale ?? 1)}
          disabled={disabled}
          options={FONT_SCALES.map((s) => ({
            value: String(s),
            label: s === 1 ? "Normal (×1)" : `×${s}`,
          }))}
          onChange={(v) => patchStyle({ fontScale: Number(v) })}
        />
        <SelectField
          label="Yazı kalınlığı"
          value={style.fontWeight ?? "normal"}
          disabled={disabled}
          options={[
            { value: "light", label: "İnce" },
            { value: "normal", label: "Normal" },
            { value: "bold", label: "Kalın" },
          ]}
          onChange={(v) => patchStyle({ fontWeight: v as DocStyleConfig["fontWeight"] })}
        />
        <SelectField
          label="Tablo yoğunluğu"
          value={style.tableDensity ?? "normal"}
          disabled={disabled}
          options={[
            { value: "compact", label: "Sıkışık" },
            { value: "normal", label: "Normal" },
            { value: "relaxed", label: "Ferah" },
          ]}
          onChange={(v) => patchStyle({ tableDensity: v as DocStyleConfig["tableDensity"] })}
        />
        <SelectField
          label="Tablo stili"
          value={style.tableStyle ?? "grid"}
          disabled={disabled}
          options={[
            { value: "grid", label: "Tam çerçeve" },
            { value: "zebra", label: "Zebra (çizgili satır)" },
            { value: "plain", label: "Sade (yatay çizgi)" },
          ]}
          onChange={(v) => patchStyle({ tableStyle: v as DocStyleConfig["tableStyle"] })}
        />
      </div>

      <div className="mt-3 border-t pt-3">
        <FlagToggle
          title="Logoyu bas"
          desc="Şirket Bilgileri sekmesinden yüklenen logo belge başlığına eklenir (logo yoksa basılmaz)."
          checked={cfg?.showLogo !== false}
          disabled={disabled}
          onChange={(v) => patch({ showLogo: v })}
        />
        {cfg?.showLogo !== false && (
          <div className="mt-2 max-w-[220px]">
            <SelectField
              label="Logo konumu"
              value={cfg?.logoPosition ?? "left"}
              disabled={disabled}
              options={[
                { value: "left", label: "Sol (firma adının üstü)" },
                { value: "right", label: "Sağ (başlığın üstü)" },
              ]}
              onChange={(v) => patch({ logoPosition: v === "right" ? "right" : "left" })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
