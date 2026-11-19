// (i) ikonu → açıklama balonu: uzun alan/ayar açıklamasını satırdan kaldırıp "iste-gör" tetiğin arkasına alır.
// Fare üstünde açılır; dokunma/tıklama sabitler (tablette hover yok); klavye odağında açılır, Esc kapatır.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Balon yalnız klavye odağında açılır: diyalog açılışındaki otomatik odak (ilk odaklanabilir = ⓘ) onu kendiliğinden açmasın.
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true; // seçiciyi tanımayan ortam: eski davranış (odakta aç)
  }
}

/**
 * (i) ikonu → açıklama balonu. Davranış:
 *  - Fareyle ikonun (veya balonun) ÜSTÜNE gelince açılır; ayrılınca kısa
 *    gecikmeyle kapanır (ikon↔balon boşluğunu geçerken kapanmasın diye).
 *  - İkona TIKLAYINCA SABİTLENİR: fare ayrılsa da açık kalır; başka bir yere
 *    tıklayana (veya Esc) ya da ikona tekrar tıklayana kadar açık durur.
 */
export function InfoPopover({
  desc,
  label = "Açıklama",
  className,
}: {
  desc: ReactNode;
  label?: string;
  className?: string;
}) {
  const descId = useId();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  const timer = useRef<number | null>(null);

  const setPin = (v: boolean) => {
    pinnedRef.current = v;
    setPinned(v);
  };
  const clearTimer = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const openNow = () => {
    clearTimer();
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, 140);
  };
  useEffect(() => clearTimer, []);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Radix dışa-tıklama / Esc ile kapatınca sabitlemeyi de kaldır.
        setOpen(o);
        if (!o) setPin(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pinned}
          aria-describedby={open ? descId : undefined}
          onFocus={(e) => focusVisible(e.currentTarget) && openNow()}
          onBlur={closeSoon}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          onClick={(e) => {
            // Kendi kontrolümüz → Radix'in kendi toggle'ını atla (preventDefault).
            e.stopPropagation();
            e.preventDefault();
            clearTimer();
            const next = !pinnedRef.current;
            setPin(next);
            setOpen(next);
          }}
          className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground", className)}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id={descId}
        role="tooltip"
        align="start"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[26rem] max-w-[90vw] p-4 text-sm leading-relaxed text-foreground"
      >
        {desc}
      </PopoverContent>
    </Popover>
  );
}
