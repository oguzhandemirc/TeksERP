// Ekran görüntüsü üstü çizim — SAF model (React'siz; geri al/yinele testi bunu koşar).
// Koordinatlar her zaman KAYNAK görüntünün piksel uzayındadır; ekrandaki ölçek yalnız çizim anında uygulanır.

export type Tool = "pen" | "arrow" | "rect" | "highlight" | "text" | "redact" | "crop";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PathShape {
  kind: "pen" | "highlight";
  points: Point[];
  color: string;
  width: number;
}
export interface LineShape {
  kind: "arrow" | "rect" | "redact";
  from: Point;
  to: Point;
  color: string;
  width: number;
}
export interface TextShape {
  kind: "text";
  at: Point;
  text: string;
  color: string;
  size: number;
}
export type Shape = PathShape | LineShape | TextShape;

/** Geri alınabilir tek durum: şekiller + kırpma. Kırpma da geri alınabilsin diye anlık görüntüye girer. */
export interface Snapshot {
  shapes: Shape[];
  crop: Rect | null;
}

export interface History {
  stack: Snapshot[];
  index: number;
}

export const EMPTY_SNAPSHOT: Snapshot = { shapes: [], crop: null };

export function createHistory(): History {
  return { stack: [EMPTY_SNAPSHOT], index: 0 };
}

export function current(h: History): Snapshot {
  return h.stack[h.index] ?? EMPTY_SNAPSHOT;
}

/** Yeni durum: ileri (yinelenebilir) dal kesilir. */
export function commit(h: History, next: Snapshot): History {
  const stack = [...h.stack.slice(0, h.index + 1), next];
  return { stack, index: stack.length - 1 };
}

export function addShape(h: History, shape: Shape): History {
  const cur = current(h);
  return commit(h, { ...cur, shapes: [...cur.shapes, shape] });
}

export function setCrop(h: History, crop: Rect | null): History {
  return commit(h, { ...current(h), crop });
}

/** Temizle de geri alınabilir: boş durum yeni bir adımdır (zaten boşsa adım eklenmez). */
export function clearAll(h: History): History {
  const cur = current(h);
  if (cur.shapes.length === 0 && cur.crop === null) return h;
  return commit(h, EMPTY_SNAPSHOT);
}

export const canUndo = (h: History): boolean => h.index > 0;
export const canRedo = (h: History): boolean => h.index < h.stack.length - 1;

export function undo(h: History): History {
  return canUndo(h) ? { ...h, index: h.index - 1 } : h;
}

export function redo(h: History): History {
  return canRedo(h) ? { ...h, index: h.index + 1 } : h;
}

/** İki noktadan normalize dikdörtgen (sürükleme yönünden bağımsız). */
export function rectFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Dikdörtgeni görüntü sınırlarına kırpar; anlamsız küçük (<8 px) kırpma `null`. */
export function clampRect(r: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(r.x, width));
  const y = Math.max(0, Math.min(r.y, height));
  const w = Math.min(r.w, width - x);
  const h = Math.min(r.h, height - y);
  return w >= 8 && h >= 8 ? { x, y, w, h } : null;
}

/** Çıktı boyutu: uzun kenar `maxEdge`i aşarsa orantılı küçült (büyütme yok). */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number; scale: number } {
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}
