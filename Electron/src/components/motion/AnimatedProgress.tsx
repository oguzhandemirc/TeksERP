import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { springSoft } from "@/lib/motion";

interface Props {
  /** 0–100 arası yüzde. */
  value: number;
  /** Track (dış) sınıfları — yükseklik/genişlik. */
  className?: string;
  /** Dolan çubuğun sınıfları — renk. Varsayılan accent. */
  barClassName?: string;
}

/** Yaylı dolan ilerleme çubuğu. Değer değişince yumuşakça yeni orana akar. */
export function AnimatedProgress({ value, className, barClassName }: Props) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <motion.div
        className={cn("h-full rounded-full bg-primary", barClassName)}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={springSoft}
      />
    </div>
  );
}
