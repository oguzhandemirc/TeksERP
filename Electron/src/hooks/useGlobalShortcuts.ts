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
 *  - `Alt+←` ve FARE GERİ TUŞU → aktif sekmede bir adım geri
 *
 * Bir barkod tabancası scan'i sürerken (`isScannerCapturing`) bu kısayollar
 * bastırılır — kodun ilk karakteri yanlışlıkla `g`/`/` gibi davranmasın.
 *
 * ⚠️ Geri hareketlerinde `preventDefault()` ŞART (2026-08-22): uygulama kabuğu
 * bilerek bir data-router DIŞINDA yaşıyor (`App.tsx`), yani tarayıcının kendi
 * geçmişi sekmelerin memory router'larını TANIMAZ — varsayılan davranış
 * webContents geçmişini geri sarar ve kullanıcıyı oturum-dışı router'a (login
 * ekranı) düşürebilirdi. Geri kararı tek yerden verilir: `backActive`.
 */
export function useGlobalShortcuts({ onOpenCommand, onOpenHelp, isScannerCapturing }: Options) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const backActive = useTabsStore((s) => s.backActive);

  useEffect(() => {
    let goPending = false;
    let goTimer: ReturnType<typeof setTimeout> | null = null;
    const clearGo = () => {
      goPending = false;
      if (goTimer) clearTimeout(goTimer);
      goTimer = null;
    };

    const handler = (e: KeyboardEvent) => {
      // Alt+← — modifier kapısından ÖNCE. Yazarken devre dışı: uzun bir nota
      // kelime atlamak için basan kullanıcıyı sayfadan atmak, kazandırdığından
      // fazlasını kaybettirir (form durumu gider).
      if (e.altKey && e.key === "ArrowLeft" && !e.ctrlKey && !e.metaKey && !isTyping(e.target)) {
        e.preventDefault();
        backActive();
        return;
      }
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

    // Farenin yan (geri/ileri) tuşları. Chromium bunları `mousedown` ile bildirir
    // ve varsayılan gezinme YALNIZ orada iptal edilebilir — `mouseup`ta geç kalınır.
    const mouseHandler = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.button === 3) backActive();
      // İleri (4) bilinçli olarak BOŞ: sekme geçmişinde ileri gitmenin bir yüzeyi
      // yok; yine de varsayılanı iptal ediyoruz ki webContents geri/ileri sarmasın.
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("mousedown", mouseHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("mousedown", mouseHandler);
      clearGo();
    };
  }, [navigateActive, backActive, onOpenCommand, onOpenHelp, isScannerCapturing]);
}
