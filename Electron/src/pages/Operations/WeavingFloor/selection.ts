// Tezgah Salonu çoklu seçimi — SAF çekirdek (tık / Ctrl / Shift / lasso / Ctrl+A).
// Seçim tezgah KİMLİĞİYLE tutulur: 5 sn tazelemede sıra/durum değişse de korunur.
// Tasarım: docs/design/TEZGAH-SALONU-SECIM-IS-VERME.md §A.

export interface Selection {
  ids: ReadonlySet<string>;
  /** Shift+tık aralığının başı (son tek/Ctrl tıklanan). */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

export interface ClickMods {
  /** Ctrl (Windows) ya da Cmd (macOS). */
  toggle: boolean;
  range: boolean;
}

/** `order` = ekrandaki sıra, yalnız GÖRÜNEN kartlar (hol sırası, sonra tezgah no). */
export function applyClick(sel: Selection, id: string, mods: ClickMods, order: readonly string[]): Selection {
  if (mods.range && sel.anchor && order.includes(sel.anchor) && order.includes(id)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(id);
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const ids = new Set(mods.toggle ? sel.ids : []);
    for (const x of span) ids.add(x);
    return { ids, anchor: sel.anchor };
  }
  if (mods.toggle) {
    const ids = new Set(sel.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

/** Lasso / hol seçimi / Ctrl+A: `add` = mevcut seçime ekle (Ctrl basılı), değilse yenile. */
export function applyMany(sel: Selection, picked: readonly string[], add: boolean): Selection {
  const ids = new Set(add ? sel.ids : []);
  for (const x of picked) ids.add(x);
  return { ids, anchor: picked[0] ?? sel.anchor };
}

/** Listeden düşen (pasife alınan) tezgahlar seçimden sessizce çıkar; kaç tanesinin düştüğü döner. */
export function pruneSelection(sel: Selection, present: ReadonlySet<string>): { sel: Selection; dropped: number } {
  const kept = [...sel.ids].filter((x) => present.has(x));
  if (kept.length === sel.ids.size) return { sel, dropped: 0 };
  return { sel: { ids: new Set(kept), anchor: sel.anchor && present.has(sel.anchor) ? sel.anchor : null }, dropped: sel.ids.size - kept.length };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** İki köşeden kutu (sürükleme hangi yöne olursa olsun). */
export function boxOf(x1: number, y1: number, x2: number, y2: number): Box {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

/** Dikdörtgene DEĞEN kart seçilir (tamamen içinde olması gerekmez). */
export function intersects(a: Box, b: Box): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

/** 4 px'ten kısa sürükleme tıktır — yanlışlıkla seçim olmasın. */
export const LASSO_MIN_PX = 4;

export function isDrag(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.abs(x2 - x1) >= LASSO_MIN_PX || Math.abs(y2 - y1) >= LASSO_MIN_PX;
}

export function lassoPick(box: Box, cards: ReadonlyArray<{ id: string; box: Box }>): string[] {
  return cards.filter((c) => intersects(box, c.box)).map((c) => c.id);
}

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Ok tuşuyla komşu kart (ızgara kolon sayısı ekrana göre değiştiği için GEOMETRİDEN): sağ/sol aynı
 * sıradaki en yakın, aşağı/yukarı bir sonraki sıradaki yatayda en yakın kart. Yoksa null.
 */
export function neighborOf(current: Box, key: ArrowKey, cards: ReadonlyArray<{ id: string; box: Box }>): string | null {
  const cx = (current.left + current.right) / 2;
  const cy = (current.top + current.bottom) / 2;
  let best: { id: string; score: number } | null = null;
  for (const c of cards) {
    const x = (c.box.left + c.box.right) / 2;
    const y = (c.box.top + c.box.bottom) / 2;
    const dx = x - cx;
    const dy = y - cy;
    const sameRow = Math.abs(dy) < (current.bottom - current.top) / 2;
    let score: number | null = null;
    if (key === "ArrowRight" && sameRow && dx > 1) score = dx;
    if (key === "ArrowLeft" && sameRow && dx < -1) score = -dx;
    if (key === "ArrowDown" && dy > (current.bottom - current.top) / 2) score = dy * 1000 + Math.abs(dx);
    if (key === "ArrowUp" && dy < -(current.bottom - current.top) / 2) score = -dy * 1000 + Math.abs(dx);
    if (score !== null && (!best || score < best.score)) best = { id: c.id, score };
  }
  return best?.id ?? null;
}
