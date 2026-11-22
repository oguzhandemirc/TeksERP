// Izgara kutusu: dar pencerede yatay/dikey kaydırma YALNIZ burada olur (sayfa kaymaz). Alttan yukarı
// görünümde 1. atkı en altta olduğundan kutu açılışta ve yön değişince alta kaydırılır.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { WeaveDirection } from "./weave-direction";

export function WeaveScrollBox({ direction, children, className, label }: {
  direction: WeaveDirection; children: ReactNode; className?: string; label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = direction === "bottom-up" ? el.scrollHeight : 0;
  }, [direction]);
  return (
    <div ref={box} role={label ? "region" : undefined} aria-label={label} tabIndex={label ? 0 : undefined}
      className={cn("w-fit max-w-full overflow-auto rounded-md border bg-background p-2", className)}>
      {children}
    </div>
  );
}
