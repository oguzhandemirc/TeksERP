// =============================================================================
// TARİH + SAAT — DatePickerInput (takvim) + yerleşik saat kutusu yan yana; değer "YYYY-MM-DDTHH:mm" (yerel)
// =============================================================================
// Kullanıcının şikâyeti takvim girdisiydi; saat yerleşik kalır (`type="time"`). Birleştirme/ayırma tek yerde
// (`lib/date-time-input.ts`). Eski `datetime-local` sözleşmesi korunur — çağıranın dönüştürücüsü değişmez.
// =============================================================================
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { joinDateTime, splitDateTime } from "@/lib/date-time-input";
import { DatePickerInput } from "./DatePickerInput";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Saat boşken varsayılan (ör. "08:00"); verilmezse 00:00. */
  defaultTime?: string;
  /** Tarih kutusu ipucu. */
  title?: string;
}

export function DateTimeInput({ value, onChange, disabled, className, id, "aria-label": ariaLabel, defaultTime, title }: Props) {
  const { date, time } = splitDateTime(value);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <DatePickerInput id={id} aria-label={ariaLabel ? `${ariaLabel} — tarih` : "Tarih"} title={title} value={date} onChange={(d) => onChange(joinDateTime(d, time, defaultTime))} disabled={disabled} className="min-w-0 flex-1" />
      <Input type="time" aria-label={ariaLabel ? `${ariaLabel} — saat` : "Saat"} value={time} disabled={disabled || !date} onChange={(e) => onChange(joinDateTime(date, e.target.value, defaultTime))} className="h-9 w-[104px] shrink-0 px-2 text-sm" />
    </div>
  );
}
