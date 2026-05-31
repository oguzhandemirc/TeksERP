import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

/**
 * Uygulama geneli hareket konfigürasyonu.
 * `reducedMotion="user"` → OS "hareketi azalt" ayarına saygı duyar; bu durumda
 * framer-motion transform/layout animasyonlarını otomatik kapatır (erişilebilirlik).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
