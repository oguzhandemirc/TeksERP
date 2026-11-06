import { create } from "zustand";
import { useTabsStore } from "@/store/tabs";
import { getDirtyTabIds } from "./dirty-tabs";
import { idsToClose, type CloseScope } from "./tab-close";
import { closeTabsWithUndo } from "./close-with-undo";

/**
 * Kirli sekme kapısı — sekme kapatmanın (tek/toplu/kısayol/sağ tık) ve elle çıkışın TEK girişi.
 * Kapanacak sekmelerde kaydedilmemiş değişiklik varsa onay sorar; yoksa eskisi gibi hemen yürür.
 */

export type DirtyConfirmKind = "close" | "logout";

export interface DirtyConfirmRequest {
  kind: DirtyConfirmKind;
  /** Kirli sekmelerin başlıkları (şerit sırasıyla). */
  titles: string[];
  proceed: () => void;
}

interface DirtyConfirmState {
  pending: DirtyConfirmRequest | null;
  ask: (req: DirtyConfirmRequest) => void;
  /** "Kapat"/"Çıkış yap": isteği yürüt ve kapat. */
  confirm: () => void;
  /** "Vazgeç": hiçbir şey kapanmaz. */
  cancel: () => void;
}

export const useDirtyConfirmStore = create<DirtyConfirmState>()((set, get) => ({
  pending: null,
  ask: (req) => set({ pending: req }),
  confirm: () => {
    const req = get().pending;
    set({ pending: null });
    req?.proceed();
  },
  cancel: () => set({ pending: null }),
}));

/** Verilen sekmelerden kirli olanların başlıkları (şerit sırasıyla). */
export function dirtyTitles(ids: readonly string[]): string[] {
  const dirty = getDirtyTabIds();
  const wanted = new Set(ids.filter((id) => dirty.has(id)));
  return useTabsStore.getState().tabs.filter((t) => wanted.has(t.id)).map((t) => t.title);
}

function guard(kind: DirtyConfirmKind, ids: readonly string[], proceed: () => void): void {
  const confirm = useDirtyConfirmStore.getState();
  if (confirm.pending) return; // onay açıkken ikinci kısayol/tık yeni soru açmaz
  const titles = dirtyTitles(ids);
  if (titles.length === 0) proceed();
  else confirm.ask({ kind, titles, proceed });
}

/** Sekme kapatma (her yol): kirli sekme varsa onaydan sonra; toplu kapatmada "Geri al" bildirimi korunur. */
export function requestCloseTabs(scope: CloseScope, anchorId: string | null = null): void {
  const ids = idsToClose(useTabsStore.getState().tabs, anchorId, scope);
  if (ids.length === 0) return;
  guard("close", ids, () => closeTabsWithUndo(scope, anchorId));
}

/** Elle çıkış (menü/komut paleti): açık sekmelerden biri kirliyse önce sorar. Zorunlu çıkış (hareketsizlik, süre) bu kapıdan geçmez. */
export function requestLogout(run: () => void): void {
  guard("logout", useTabsStore.getState().tabs.map((t) => t.id), run);
}

/** Onay metni (modal açıklaması, satır kırımlı) — saf, test edilir. */
export function dirtyConfirmText(req: Pick<DirtyConfirmRequest, "kind" | "titles">): string {
  const head = `${req.titles.length} sekmede kaydedilmemiş değişiklik var:\n${req.titles.map((t) => `• ${t}`).join("\n")}`;
  return req.kind === "logout"
    ? `${head}\n\nYine de çıkılsın mı? Yazılanlar kaybolur.`
    : `${head}\n\nYine de kapatılsın mı? Yazılanlar kaybolur ("Geri al" yalnız sekmeyi getirir).`;
}
