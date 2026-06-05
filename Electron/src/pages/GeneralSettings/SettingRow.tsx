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
