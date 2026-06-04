import type { MouseEvent } from "react";
import { useTabsStore } from "@/store/tabs";

interface ClickLike {
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Olay yeni sekme mi istiyor? shift / ctrl / cmd / orta tık / sağ tık. */
function wantsNewTab(e?: ClickLike): boolean {
  if (!e) return false;
  return Boolean(e.shiftKey || e.ctrlKey || e.metaKey || e.button === 1 || e.button === 2);
}

/**
 * Bir hedefi açmak için olay-duyarlı fonksiyon:
 *  - sol tık → aktif sekmede yerinde aç
 *  - shift / ctrl / cmd / orta tık / sağ tık → yeni sekme
 */
export function useOpenTarget() {
  const openTab = useTabsStore((s) => s.openTab);
  const navigateActive = useTabsStore((s) => s.navigateActive);

  return (path: string, e?: ClickLike, state?: unknown) => {
    if (wantsNewTab(e)) openTab(path, { forceNew: true, state });
    else navigateActive(path, { state });
  };
}

/**
 * Tıklanabilir bir öğeye yayılacak hazır prop demeti. Sol tık mevcut sekmede,
 * shift/ctrl/cmd ile sol tık + orta tık + sağ tık yeni sekmede açar.
 */
export function useTabTarget(path: string) {
  const open = useOpenTarget();
  return {
    onClick: (e: MouseEvent) => open(path, e),
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        open(path, e);
      }
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      open(path, { button: 2 });
    },
  };
}
