import { useEffect } from "react";
import { useTabsStore } from "@/store/tabs";
import { isCloseAllShortcut } from "@/components/layout/tabs/tab-close";
import { closeTabsWithUndo } from "@/components/layout/tabs/close-with-undo";

/**
 * Sekme klavye kısayolları (tarayıcı benzeri):
 *  - Ctrl/Cmd+T → yeni sekme (Anasayfa)
 *  - Ctrl/Cmd+W → aktif sekmeyi kapat
 *  - Ctrl+Shift+W → tüm sekmeleri kapat (macOS'ta da Ctrl; Cmd+Shift+W pencereyi kapatır)
 *  - Ctrl+Tab / Ctrl+Shift+Tab → sonraki / önceki sekme (Cmd+Tab macOS'ta
 *    uygulama değiştirici olduğundan bilerek Ctrl)
 *  - Ctrl/Cmd+1..8 → o sıradaki sekme, Ctrl/Cmd+9 → son sekme
 *
 * Windows/Linux'ta menü olmadığından tüm kombinasyonlar serbest; macOS'ta
 * Cmd+W menüde sekme-kapatmaya bırakıldı (pencere kapatma Cmd+Shift+W).
 */
export function useTabShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && e.key !== "Tab") return;
      const s = useTabsStore.getState();

      if (mod && !e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        s.openTab("/", { forceNew: true });
        return;
      }

      if (isCloseAllShortcut(e)) {
        e.preventDefault();
        closeTabsWithUndo("all");
        return;
      }

      if (mod && !e.shiftKey && (e.key === "w" || e.key === "W")) {
        if (!s.activeId) return;
        e.preventDefault();
        s.closeTab(s.activeId);
        return;
      }

      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        s.cycle(e.shiftKey ? -1 : 1);
        return;
      }

      if (mod && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const n = Number(e.key);
        s.selectIndex(n === 9 ? s.tabs.length - 1 : n - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
