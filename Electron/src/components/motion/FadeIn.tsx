import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { easeOut, fadeInUp, staggerContainer, staggerItem } from "@/lib/motion";

/** Tek bir öğeyi alttan kayarak içeri alır (opsiyonel gecikme ile). */
export function FadeInUp({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={fadeInUp}
      initial="hidden"
      animate="show"
      transition={{ ...easeOut, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Çocuklarını sırayla içeri alan konteyner. Çocukları <StaggerItem> olmalı. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/** Stagger konteyneri içindeki tekil öğe sarmalayıcısı. */
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}
