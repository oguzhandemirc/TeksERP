import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  className?: string;
  /** Ondalık hane sayısı (varsayılan 0). */
  decimals?: number;
  /** İlk render dışında değer değişince kısa accent vurgusu. */
  flash?: boolean;
}

/**
 * Sayıyı önceki değerden hedefe doğru sayarak gösterir (tr-TR formatı).
 * OS "hareketi azalt" açıksa anında değeri yazar. `flash` ile güncellemede vurgu.
 */
export function AnimatedNumber({ value, className, decimals = 0, flash = false }: Props) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) =>
    v.toLocaleString("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  );

  const [flashing, setFlashing] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value, reduce]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!flash || reduce) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 900);
    return () => clearTimeout(t);
  }, [value, flash, reduce]);

  return <motion.span className={cn(className, flashing && "value-flash")}>{text}</motion.span>;
}
