import { useEffect } from "react";
import { useTabsStore } from "@/store/tabs";
import { isTyping } from "@/lib/scanner/is-typing";

// "g" sonrası tuş → hedef route (g-then-key gezinme deseni).
const GO: Record<string, string> = {
  d: "/",
  o: "/operations",
  t: "/definitions",
  r: "/reports",
};

interface Options {
  onOpenCommand: () => void;
  onOpenHelp: () => void;
  /** Barkod-wedge scan birikiyorsa true — tek-tuş kısayolları bastırılır. */
  isScannerCapturing?: () => boolean;
}

/**
 * Global klavye kısayolları (input'larda devre dışı):
 *  - `g` ardından `d/o/t/r` → Anasayfa/Operasyon/Tanımlar/Raporlar
 *  - `/` → arama (komut paleti)
 *  - `?` → kısayol rehberi
 *
 * Bir barkod tabancası scan'i sürerken (`isScannerCapturing`) bu kısayollar
 * bastırılır — kodun ilk karakteri yanlışlıkla `g`/`/` gibi davranmasın.
 */
export function useGlobalShortcuts({ onOpenCommand, onOpenHelp, isScannerCapturing }: Options) {
  const navigateActive = useTabsStore((s) => s.navigateActive);

  useEffect(() => {
    let goPending = false;
    let goTimer: ReturnType<typeof setTimeout> | null = null;
    const clearGo = () => {
      goPending = false;
      if (goTimer) clearTimeout(goTimer);
      goTimer = null;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      // Barkod scan ortasındaysa kısayolları yut — wedge capture fazında çalışır,
      // bu yüzden burada (bubble) isCapturing() zaten güncel.
      if (isScannerCapturing?.()) {
        clearGo();
        return;
      }

      if (goPending) {
        const dest = GO[e.key.toLowerCase()];
        clearGo();
        if (dest) {
          e.preventDefault();
          navigateActive(dest);
        }
        return;
      }

      if (e.key === "g") {
        goPending = true;
        goTimer = setTimeout(clearGo, 1200);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        onOpenHelp();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        onOpenCommand();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearGo();
    };
  }, [navigateActive, onOpenCommand, onOpenHelp, isScannerCapturing]);
}
