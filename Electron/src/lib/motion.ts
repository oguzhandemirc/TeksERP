import type { Transition, Variants } from "framer-motion";

// Uygulama geneli hareket sözlüğü. Tüm bileşenler buradaki preset'leri kullanır
// ki his tutarlı kalsın. "Canlı & belirgin" doz: yaylı (spring) etkileşimler,
// hızlı ama hissedilir sayfa geçişleri.

/** Hızlı, hafif yaylı geçiş — buton/pill/kart etkileşimleri. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 34,
  mass: 0.7,
};

/** Yumuşak yaylı geçiş — layout/panel kaymaları. */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 30,
};

/** Standart easing — fade/translate tween'leri. */
export const easeOut: Transition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] };

/** Sayfa geçişi — belirgin ama hızlı (mode="wait" çift süreyi önlemek için kısa). */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.995 },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.995,
    transition: { duration: 0.12, ease: "easeIn" },
  },
};

/** Stagger konteyneri — çocukları sırayla içeri alır. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

/** Stagger çocuğu — alttan kayarak yaylı giriş. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: springSnappy },
};

/** Tekil giriş (transition çağıran bileşende verilir, delay desteklenir). */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};
