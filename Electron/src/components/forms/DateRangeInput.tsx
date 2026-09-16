// =============================================================================
// TARİH ARALIĞI — iki DatePickerInput (başlangıç – bitiş), "–" ayraç (emsal Shipments/detail/DateRangeFilter)
// =============================================================================
// Tutarlılık: bitiş < başlangıç ise TAKAS DEĞİL — iki kutu amber (`invalid`) + `role="status"` uyarısı, değer
// yine geçer (kullanıcı düzeltir; sunucu süzgeci boş sonuç verir, sessizce başka bir aralık uydurulmaz).
// =============================================================================
import { cn } from "@/lib/utils";
import { DatePickerInput } from "./DatePickerInput";

interface Props {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  fromLabel?: string;
  toLabel?: string;
  idPrefix?: string;
}

export function rangeInverted(from: string, to: string): boolean {
  return Boolean(from && to && to < from);
}

export function DateRangeInput({ from, to, onFrom, onTo, disabled, className, inputClassName, fromLabel = "Başlangıç tarihi", toLabel = "Bitiş tarihi", idPrefix }: Props) {
  const inverted = rangeInverted(from, to);
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <DatePickerInput id={idPrefix ? `${idPrefix}-from` : undefined} aria-label={fromLabel} title={fromLabel} placeholder="Başlangıç" value={from} onChange={onFrom} disabled={disabled} invalid={inverted} className={cn("w-[150px]", inputClassName)} />
      <span className="text-muted-foreground" aria-hidden>–</span>
      <DatePickerInput id={idPrefix ? `${idPrefix}-to` : undefined} aria-label={toLabel} title={`${toLabel} (gün sonu dahil)`} placeholder="Bitiş" value={to} onChange={onTo} disabled={disabled} invalid={inverted} className={cn("w-[150px]", inputClassName)} />
      {inverted && (
        <span role="status" aria-live="polite" className="basis-full text-[11px] text-amber-700 dark:text-amber-400">
          Bitiş tarihi başlangıçtan önce — aralık boş sonuç verir.
        </span>
      )}
    </div>
  );
}
