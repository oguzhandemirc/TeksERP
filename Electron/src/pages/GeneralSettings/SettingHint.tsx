import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Ayar açıklamasının gösterim biçimi. Amaç: ayar ekranındaki uzun açıklama
 * metnini satırdan kaldırıp "iste-gör" bir tetiğin arkasına almak.
 *  - inline:     açıklama başlığın altında HER ZAMAN görünür (klasik / mevcut).
 *  - popover:    başlık yanında (i) ikonu; tıklayınca açıklama balonda açılır.
 *  - disclosure: başlık altında "Açıklama ▾"; tıklayınca satır altında inline açılır.
 */
export type HintVariant = "inline" | "popover" | "disclosure";

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
}: {
  desc: ReactNode;
  label?: string;
}) {
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
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
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

/** "Açıklama ▾" bağlantısı → açıklamayı satır altında inline aç/kapat. */
export function InfoDisclosure({ desc }: { desc: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        Açıklama
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <p className="mt-1 leading-relaxed text-muted-foreground">{desc}</p>}
    </div>
  );
}

/**
 * Başlık satırının yanında yalnız `popover` modunda (i) ikonu gösterir.
 * inline/disclosure modlarında hiçbir şey basmaz (açıklama başlık ALTINDA gelir).
 */
export function HintIcon({ variant, desc }: { variant: HintVariant; desc: ReactNode }) {
  if (variant !== "popover" || !desc) return null;
  return <InfoPopover desc={desc} />;
}

/**
 * Başlığın ALTINA gelen açıklama gövdesi: inline → düz metin, disclosure → aç/kapat,
 * popover → hiçbir şey (açıklama başlık yanındaki ikonda). Boş desc'te hiçbir şey.
 */
export function HintBody({ variant, desc }: { variant: HintVariant; desc: ReactNode }) {
  if (!desc) return null;
  if (variant === "inline") return <p className="text-xs text-muted-foreground">{desc}</p>;
  if (variant === "disclosure") return <InfoDisclosure desc={desc} />;
  return null;
}
