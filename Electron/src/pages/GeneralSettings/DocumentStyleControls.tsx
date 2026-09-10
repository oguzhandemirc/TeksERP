import type { DocumentConfig, DocStyleConfig } from "@/services/documentConfig";
import { FlagToggle } from "./SettingRow";

// =============================================================================
// Belge görünüm (stil) kontrolleri — DocumentConfigSection'ın alt paneli.
// Sayfa boyutu / kenar boşluğu / yazı ölçeği-kalınlığı / tablo yoğunluk-stili
// + logo bas/konum. Ham (kısmi) config'e patch atar; çözüm backend renderer'da.
// =============================================================================

const FONT_SCALES = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4] as const;

type MarginSide = "top" | "right" | "bottom" | "left";

const MARGIN_SIDES: { side: MarginSide; label: string }[] = [
  { side: "top", label: "Üst" },
  { side: "right", label: "Sağ" },
  { side: "bottom", label: "Alt" },
  { side: "left", label: "Sol" },
];

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

  const margins = style.margins;
  /** Tek kenarı yazar; diğer kenarlar dokunulmadan kalır (boş → belge varsayılanı). */
  const patchMargin = (side: MarginSide, raw: string) => {
    const next = { ...(margins ?? {}) };
    if (raw === "") delete next[side];
    else next[side] = Math.min(40, Math.max(0, Number(raw)));
    patchStyle({ margins: Object.keys(next).length ? next : undefined });
  };
  /** "Tümüne uygula" — dört kenara aynı değer (eski tek-alan davranışı). */
  const applyAll = (raw: string) => {
    if (raw === "") {
      patchStyle({ margins: undefined });
      return;
    }
    const n = Math.min(40, Math.max(0, Number(raw)));
    patchStyle({ margins: { top: n, right: n, bottom: n, left: n } });
  };

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

      {/* A5 TUZAĞI (2026-09-10 saha) — Chromium `@page size: A5`i A4 kâğıda
          BÜYÜTMEZ, olduğu gibi ortalar: yazı alanı 130mm, A4'ün 210mm'sinde %62
          eder ve iki yandan ~40mm boşluk kalır. Sahada tam bu yaşandı ve
          "yazıcı bozuldu" diye geldi. Uyarı yalnız A5 seçiliyken çizilir. */}
      {style.pageSize === "A5" && (
        <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          Yazıcınızda <b>A5 kağıt yoksa</b> çıktı A4'ün ortasına küçük basılır — kâğıdın
          yaklaşık %60'ı kullanılır. A4 kağıda basıyorsanız sayfa boyutunu A4 bırakın.
        </p>
      )}

      {/* Kenar boşlukları KENAR KENAR — eskiden tek alan vardı ve dördüne aynı
          değeri yazıyordu, yani "üstten şu kadar, alttan bu kadar" denemiyordu
          (saha isteği). Backend `sanitizeDocStyleConfig` zaten kenar bazlıydı. */}
      <div className="mt-3 border-t pt-3">
        <div className="flex items-center justify-between pb-2">
          <span className="text-xs font-medium">Kenar boşluğu (mm)</span>
          <input
            type="number"
            min={0}
            max={40}
            placeholder="tümüne"
            disabled={disabled}
            value=""
            onChange={(e) => applyAll(e.target.value)}
            title="Yazılan değer dört kenara birden uygulanır"
            className="h-7 w-20 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MARGIN_SIDES.map((s) => (
            <div key={s.side}>
              <label className="text-xs text-muted-foreground">{s.label}</label>
              <input
                type="number"
                min={0}
                max={40}
                value={margins?.[s.side] ?? ""}
                placeholder="varsayılan"
                disabled={disabled}
                onChange={(e) => patchMargin(s.side, e.target.value)}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Boş bırakılan kenar belgenin kendi varsayılanını kullanır. Yazıcının kendi
          basılamayan alanı bunun üstüne eklenir — kâğıtta ölçüp ayarlayın.
        </p>
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
