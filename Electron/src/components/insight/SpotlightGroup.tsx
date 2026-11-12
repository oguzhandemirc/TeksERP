import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SpotlightController } from "./useSpotlight";

/**
 * Spot ışığı görünümü — `regionProps`/`dimProps` taşıyan her köke eklenir. Renk tema belirteçlerinden;
 * soluk alan `pointer-events` korur (modal değil); hareket azaltılmışsa geçiş yok.
 */
export const SPOTLIGHT_CLASS = cn(
  "scroll-mt-6 rounded-xl transition-[opacity,box-shadow,background-color] duration-300 motion-reduce:transition-none",
  "data-[spotlight=lit]:bg-primary-soft/30 data-[spotlight=lit]:ring-2 data-[spotlight=lit]:ring-primary/50",
  "data-[spotlight=dim]:opacity-40",
);

interface Props {
  controller: SpotlightController;
  children: ReactNode;
  className?: string;
}

/** Spot ışığı alanı: çocukları + ekran okuyucu duyurusu (`aria-live`). Odak ve kaydırma `useSpotlight`ta. */
export function SpotlightGroup({ controller, children, className }: Props) {
  return (
    <div className={className} data-spotlight-active={controller.activeKey === null ? undefined : "true"}>
      {children}
      <p role="status" aria-live="polite" className="sr-only">{controller.liveText}</p>
    </div>
  );
}
