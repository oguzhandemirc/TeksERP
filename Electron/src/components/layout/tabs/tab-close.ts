/**
 * Sekme kapatmanın TEK kaynağı — tekli kapatma (`closeTab`) ve toplu kapatma
 * (`closeTabs`: diğerleri/sağdakiler/soldakiler/tümü) aynı iki saf fonksiyondan
 * geçer; menüdeki pasiflik de `idsToClose(...).length === 0` ile ölçülür.
 */

export type CloseScope = "self" | "others" | "right" | "left" | "all";

/** Kapsama göre kapanacak sekme id'leri (şerit sırasıyla). Bilinmeyen çapa → boş. */
export function idsToClose(
  tabs: readonly { id: string }[],
  anchorId: string | null,
  scope: CloseScope,
): string[] {
  if (scope === "all") return tabs.map((t) => t.id);
  const idx = tabs.findIndex((t) => t.id === anchorId);
  if (idx < 0) return [];
  switch (scope) {
    case "self":
      return [tabs[idx]!.id];
    case "others":
      return tabs.filter((_, i) => i !== idx).map((t) => t.id);
    case "right":
      return tabs.slice(idx + 1).map((t) => t.id);
    case "left":
      return tabs.slice(0, idx).map((t) => t.id);
  }
}

/**
 * Kapatma sonrası etkin sekme: etkin kaldıysa o; kapandıysa özgün konumunun
 * sağındaki ilk kalan, yoksa solundaki en yakın kalan (tekli kapatmanın
 * tarihsel "önce sağ komşu, yoksa sol" kuralının genellemesi).
 */
export function nextActiveAfterClose(
  tabs: readonly { id: string }[],
  activeId: string | null,
  closed: ReadonlySet<string>,
): string | null {
  const idx = tabs.findIndex((t) => t.id === activeId);
  if (idx < 0) return tabs.find((t) => !closed.has(t.id))?.id ?? null;
  if (!closed.has(tabs[idx]!.id)) return tabs[idx]!.id;
  for (let i = idx + 1; i < tabs.length; i++) if (!closed.has(tabs[i]!.id)) return tabs[i]!.id;
  for (let i = idx - 1; i >= 0; i--) if (!closed.has(tabs[i]!.id)) return tabs[i]!.id;
  return null;
}

/**
 * "Tümünü kapat" kısayolu: YALNIZ Ctrl+Shift+W (macOS'ta da Ctrl) — Cmd+Shift+W
 * macOS menüsünde pencere kapatmaya ayrılmış (`electron/menu.ts`).
 */
export const CLOSE_ALL_SHORTCUT = "Ctrl+Shift+W";
/** Tek sekme kapatma ipucu (`useTabShortcuts`: Ctrl veya ⌘ + W). */
export const CLOSE_TAB_SHORTCUT = "Ctrl/⌘+W";
export function isCloseAllShortcut(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key">): boolean {
  return e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && (e.key === "w" || e.key === "W");
}
