import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * iOS tarzı aç/kapa anahtarı — paket YOK (Radix Switch kurulu değil, yeni paket onay
 * ister); `role="switch"` + `aria-checked` ile erişilebilir, klavye Space/Enter ile
 * çevrilir. Görünüm: 44×24, yeşil (açık) / gri (kapalı), kayan beyaz topuz.
 */
export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, disabled, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-emerald-500" : "bg-muted-foreground/30",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
});
