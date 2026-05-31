import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
}

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
}

/**
 * Global klavye kısayolları (input'larda devre dışı):
 *  - `g` ardından `d/o/t/r` → Anasayfa/Operasyon/Tanımlar/Raporlar
 *  - `/` → arama (komut paleti)
 *  - `?` → kısayol rehberi
 */
export function useGlobalShortcuts({ onOpenCommand, onOpenHelp }: Options) {
  const navigate = useNavigate();

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

      if (goPending) {
        const dest = GO[e.key.toLowerCase()];
        clearGo();
        if (dest) {
          e.preventDefault();
          navigate(dest);
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
  }, [navigate, onOpenCommand, onOpenHelp]);
}
