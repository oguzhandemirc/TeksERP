import type { ReactNode } from "react";

/**
 * Tek bir aç/kapa ayar satırı: sol tarafta başlık + açıklama, sağda checkbox.
 * `admin:settings` yetkisi olmayan kullanıcıya `ReadOnlyRow` gösterilir.
 */
export function FlagToggle({
  title,
  desc,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  desc: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div className="space-y-1 text-sm">
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-5 w-5 cursor-pointer"
      />
    </label>
  );
}

/**
 * Sayısal ayar alanı — başlık + açıklama + number input + hata satırı. Değer
 * string tutulur (geçici boş girişe izin); doğrulama/parse çağırana ait.
 */
export function NumberField({
  id,
  label,
  desc,
  value,
  min,
  max,
  onChange,
  error,
}: {
  id: string;
  label: string;
  desc: string;
  value: string;
  min: number;
  max: number;
  onChange: (next: string) => void;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Salt-okunur "etiket → değer rozeti" satırı (yetkisiz görünüm listelerinde). */
export function ReadOnlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-medium">{label}</span>
      <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs">{value}</span>
    </div>
  );
}

/** Yetkisiz kullanıcı için salt-okunur durum satırı (Açık/Kapalı rozeti). */
export function ReadOnlyRow({
  title,
  enabled,
  onLabel = "Açık",
  offLabel = "Kapalı",
}: {
  title: string;
  enabled: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">
          Bu ayarı değiştirmek için <code>admin:settings</code> yetkisi gerekir.
        </p>
      </div>
      <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs">
        {enabled ? onLabel : offLabel}
      </span>
    </div>
  );
}
