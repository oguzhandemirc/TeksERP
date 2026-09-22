import { useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface Props {
  value: string;          // "YYYY-MM-DD" veya ""
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Metin kutusunun `id`i (FormField `htmlFor` için) ve erişilebilir adı. */
  id?: string;
  "aria-label"?: string;
  name?: string;
  /** Tutarsızlık işareti (ör. bitiş < başlangıç) — amber çerçeve; değer yine geçer, engel değil. */
  invalid?: boolean;
  /** Metin kutusunun `title`ı (ipucu). */
  title?: string;
  /** Sınırlar "YYYY-MM-DD" — takvimde dışı kapalı, elle girişte dışı reddedilir (eski değer korunur). */
  min?: string;
  max?: string;
}

/** Ham rakamları "DD.MM.YYYY" maskesine dönüştürür. */
function applyMask(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4)}`;
}

/** "DD.MM.YYYY" → "YYYY-MM-DD" ISO; geçersizse null. */
function maskToIso(masked: string): string | null {
  const digits = masked.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const day   = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  const year  = parseInt(digits.slice(4, 8), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValid(new Date(iso)) ? iso : null;
}

export function DatePickerInput({
  value,
  onChange,
  placeholder = "GG.AA.YYYY",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  name,
  invalid,
  title,
  min,
  max,
}: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  const selected = value && isValid(parseISO(value)) ? parseISO(value) : undefined;
  const displayValue = selected ? format(selected, "dd.MM.yyyy") : "";

  const handleSelect = (day: Date | undefined) => {
    onChange(day ? format(day, "yyyy-MM-dd") : "");
    setOpen(false);
  };

  const handleFocus = () => {
    setFocused(true);
    setRaw(displayValue);
  };

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const handleBlur = () => {
    setFocused(false);
    const iso = maskToIso(raw);
    if (iso && inRange(iso)) onChange(iso);
    else if (raw.replace(/\D/g, "").length === 0) onChange("");
    // geçersiz giriş → sessizce eski değeri koru
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Sadece rakam + noktaya izin ver, mask uygula
    const digits = input.replace(/\D/g, "");
    setRaw(applyMask(digits));
  };

  return (
    <div className={cn("relative flex h-9 w-full items-center rounded-md border bg-background text-sm transition-colors focus-within:ring-1 focus-within:ring-ring", invalid && "border-amber-500 focus-within:ring-amber-500", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            tabIndex={-1}
            className="flex h-full items-center border-r px-2 text-primary transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 rounded-l-md"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            autoFocus
            defaultMonth={selected}
            disabled={min || max ? [...(min ? [{ before: parseISO(min) }] : []), ...(max ? [{ after: parseISO(max) }] : [])] : undefined}
          />
        </PopoverContent>
      </Popover>

      <input
        id={id}
        name={name}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={title}
        data-date-input=""
        data-min={min}
        data-max={max}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        placeholder={placeholder}
        value={focused ? raw : displayValue}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        maxLength={10}
        // ⚠️ `min-w-0 w-0` ŞART: <input>'ın içsel genişliği (~20 karakter) flex öğesinin
        // min-content'i sayılır ve 140px'lik kutudan GÖRÜNMEDEN taşar — komşu "Son 7g"
        // düğmesine tıklama girdiye düşüyordu (saha 2026-09-22).
        className="h-full w-0 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
      />

      {!disabled && displayValue && (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            onChange("");
            setRaw("");
          }}
          className="flex h-full items-center px-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
