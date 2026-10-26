// =============================================================================
// Kod modu — sunucu hata YOLU → belge aralığı (`bloklar[1].sorgu.olculer[0]` → from/to)
// =============================================================================
// Deterministik: aynı metin + aynı yol hep aynı aralık. Bulunamayan yol en yakın ATA düğüme, o da
// yoksa belgenin başına bağlanır — sunucunun bildirdiği hata hiçbir zaman kaybolmaz.
// =============================================================================
import type { EditorState } from "@codemirror/state";
import { findProperty, fullTree, propertyName, propertyValue, valueChildren, type PathSegment, type SyntaxNode } from "./json-tree";

/** `a.b[2].c` → ["a","b",2,"c"]; kök "(kök)" → []; biçimsiz yol → null. */
export function parseIssuePath(path: string): PathSegment[] | null {
  if (path === "" || path === "(kök)") return [];
  const out: PathSegment[] = [];
  const re = /\[(\d+)\]|\.?([^.[\]]+)/y;
  let i = 0;
  while (i < path.length) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m || (out.length === 0 && path[i] === ".")) return null;
    out.push(m[1] !== undefined ? Number(m[1]) : m[2]!);
    i = re.lastIndex;
  }
  return out;
}

export interface IssueRange {
  from: number;
  to: number;
  /** false: yol bulunamadı, aralık en yakın ataya/başa bağlandı. */
  exact: boolean;
}

function step(state: EditorState, node: SyntaxNode, seg: PathSegment): { value: SyntaxNode; key: SyntaxNode | null } | null {
  if (typeof seg === "number") {
    if (node.name !== "Array") return null;
    const v = valueChildren(node)[seg];
    return v ? { value: v, key: null } : null;
  }
  if (node.name !== "Object") return null;
  const prop = findProperty(state, node, seg);
  const v = prop ? propertyValue(prop) : null;
  return prop && v ? { value: v, key: propertyName(prop) } : null;
}

/** Nesne/dizi bütün bloğu çizmesin: anahtarı varsa anahtar, yoksa açılış ayracı. */
function spanOf(value: SyntaxNode, key: SyntaxNode | null): { from: number; to: number } {
  if (value.name === "Object" || value.name === "Array") return key ? { from: key.from, to: key.to } : { from: value.from, to: value.from + 1 };
  return { from: value.from, to: value.to };
}

function documentStart(state: EditorState): IssueRange {
  const line = state.doc.line(1);
  return { from: 0, to: Math.max(Math.min(line.to, state.doc.length), Math.min(1, state.doc.length)), exact: false };
}

/** Hata yolunu belgedeki aralığa eşler (sözdizimi ağacından; JSON.parse'a bağlı değil). */
export function pathToRange(state: EditorState, path: string): IssueRange {
  const segs = parseIssuePath(path);
  const root = valueChildren(fullTree(state).topNode)[0];
  if (!segs || !root) return documentStart(state);
  if (segs.length === 0) return { ...spanOf(root, null), exact: true };
  let cur: { value: SyntaxNode; key: SyntaxNode | null } = { value: root, key: null };
  for (let i = 0; i < segs.length; i++) {
    const next = step(state, cur.value, segs[i]!);
    if (!next) return i === 0 ? documentStart(state) : { ...spanOf(cur.value, cur.key), exact: false };
    cur = next;
  }
  return { ...spanOf(cur.value, cur.key), exact: true };
}
