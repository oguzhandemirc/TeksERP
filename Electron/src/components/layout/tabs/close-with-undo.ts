import { toast } from "sonner";
import { useTabsStore } from "@/store/tabs";
import type { CloseScope } from "./tab-close";

/** Toplu kapatma (menü / "Tümünü kapat" / Ctrl+Shift+W) TEK kapı: ≥2 sekme kapandıysa "Geri al"lı bildirim.
 *  Tekli kapatma bildirimsizdir (X ile aynı davranış). */
export function closeTabsWithUndo(scope: CloseScope, anchorId?: string | null): void {
  const store = useTabsStore.getState();
  const before = store.lastBulkClose;
  store.closeTabs(scope, anchorId);
  const snap = useTabsStore.getState().lastBulkClose;
  if (!snap || snap === before) return;
  toast(`${snap.closedIds.length} sekme kapatıldı`, {
    id: "tab-bulk-close",
    duration: 6000,
    action: { label: "Geri al", onClick: () => useTabsStore.getState().undoBulkClose() },
  });
}
