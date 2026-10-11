// Salonun TEK ipucu bileşeni: tarayıcının düz `title`ı yerine estetik baloncuk (radix tooltip).
// Sağlayıcı yoksa (TV kipi, tek başına bileşen testi) çocuğu olduğu gibi çizer — TV'de ipucu yok.
// Baloncuk sekmenin kök kutusuna portallanır: tam ekranda yalnız o kutu görünür (`TabPortalProvider`).
import { createContext, useContext, useRef, useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useTabPortalContainer } from "@/components/layout/tabs/tab-portal";
import { cn } from "@/lib/utils";
import type { HintModel } from "./loomHints";

const HintsEnabled = createContext(false);

export function FloorHintProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <HintsEnabled.Provider value>
      <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={150}>
        {children}
      </TooltipPrimitive.Provider>
    </HintsEnabled.Provider>
  );
}

export function HintCard({ hint }: { hint: HintModel }) {
  return (
    <div className="max-w-[17rem] space-y-1.5" data-testid="floor-hint">
      <div className="flex items-baseline gap-2">
        <span className="break-all text-[0.95em] font-extrabold leading-tight">{hint.title}</span>
        {hint.subtitle && <span className="whitespace-nowrap text-[0.85em] font-semibold text-muted-foreground">{hint.subtitle}</span>}
      </div>
      {hint.lines.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.85em]">
          {hint.lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className={cn("font-semibold tabular-nums", l.tone === "warn" && "text-amber-600 dark:text-amber-400", l.tone === "danger" && "text-destructive")}>
                {l.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hint.note && <p className="text-[0.8em] leading-snug text-muted-foreground">{hint.note}</p>}
    </div>
  );
}

function HintContent({ hint, side }: { hint: HintModel; side: "top" | "bottom" }) {
  const container = useTabPortalContainer();
  return (
    <TooltipPrimitive.Portal container={container ?? undefined}>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        collisionPadding={8}
        data-ui-pop=""
        className="z-[70] rounded-xl border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
      >
        <HintCard hint={hint} />
        <TooltipPrimitive.Arrow className="fill-popover" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

interface HintProps {
  hint: HintModel;
  /** Tek öğe — tetik olur (`asChild`). */
  children: React.ReactElement;
  side?: "top" | "bottom";
}

/** Fareyle üstüne gelince açılan ipucu (simgeler, rozetler). */
export function FloorHint({ hint, children, side = "top" }: HintProps) {
  const enabled = useContext(HintsEnabled);
  if (!enabled) return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <HintContent hint={hint} side={side} />
    </TooltipPrimitive.Root>
  );
}

/**
 * Yalnız KLAVYE odağıyla açılan ipucu (kart düğmesi): fare simgelerin kendi ipucunu açar,
 * kartın tamamı fareyle açılsa iki baloncuk üst üste binerdi.
 */
export function FocusHint({ hint, children, side = "bottom" }: HintProps) {
  const enabled = useContext(HintsEnabled);
  const [open, setOpen] = useState(false);
  const pointer = useRef(false);
  if (!enabled) return children;
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={(v) => !v && setOpen(false)}>
      <TooltipPrimitive.Trigger
        asChild
        onPointerDown={() => (pointer.current = true)}
        onFocus={() => !pointer.current && setOpen(true)}
        onBlur={() => {
          pointer.current = false;
          setOpen(false);
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <HintContent hint={hint} side={side} />
    </TooltipPrimitive.Root>
  );
}
