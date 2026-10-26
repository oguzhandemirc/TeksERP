// =============================================================================
// Kod modu — JSON sözdizimi ağacı yardımcıları (@codemirror/lang-json · Lezer)
// =============================================================================
// Hem hata yolu → konum eşlemesi hem tamamlama aynı gezinmeyi kullanır (tek kaynak): bir değerin
// yolu ağaçtan okunur, JSON.parse'a bağlı değildir — sözdizimi kırıkken de en yakın düğüm bulunur.
// =============================================================================
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type PathSegment = string | number;
// Lezer tipleri doğrudan bağımlılık değil (CodeMirror'ın içinden gelir) — tipi dil paketinden türet.
type Tree = ReturnType<typeof syntaxTree>;
export type SyntaxNode = ReturnType<Tree["resolveInner"]>;

const PUNCTUATION = new Set(["{", "}", "[", "]", ",", ":", "⚠"]);

export function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
}

/** Nesne/dizinin değer çocukları (noktalama ve hata düğümleri hariç). */
export function valueChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (!PUNCTUATION.has(c.name)) out.push(c);
  return out;
}

/** Anahtar metni (kaçışlar çözülür: `"a\"b"` → `a"b`). */
export function keyText(state: EditorState, nameNode: SyntaxNode): string {
  const raw = state.sliceDoc(nameNode.from, nameNode.to);
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}

export function propertyName(prop: SyntaxNode): SyntaxNode | null {
  return prop.getChild("PropertyName");
}

/** Özelliğin değer düğümü (adı ve `:` dışındaki son çocuk). */
export function propertyValue(prop: SyntaxNode): SyntaxNode | null {
  const vals = valueChildren(prop).filter((c) => c.name !== "PropertyName");
  return vals.length ? vals[vals.length - 1]! : null;
}

/** Nesnede anahtarı bul — çift anahtarda JSON.parse gibi SONUNCUSU geçerli. */
export function findProperty(state: EditorState, obj: SyntaxNode, key: string): SyntaxNode | null {
  let hit: SyntaxNode | null = null;
  for (const p of obj.getChildren("Property")) {
    const n = propertyName(p);
    if (n && keyText(state, n) === key) hit = p;
  }
  return hit;
}

/** Bir değer düğümünün kökten yolu (`bloklar`, 1, `sorgu`, …). */
export function pathOfNode(state: EditorState, node: SyntaxNode): PathSegment[] {
  const out: PathSegment[] = [];
  let cur: SyntaxNode = node;
  for (let parent = cur.parent; parent; parent = cur.parent) {
    if (parent.name === "Property") {
      const n = propertyName(parent);
      if (!n || !parent.parent) break;
      out.push(keyText(state, n));
      cur = parent.parent;
    } else if (parent.name === "Array") {
      out.push(valueChildren(parent).findIndex((c) => c.from === cur.from));
      cur = parent;
    } else break;
  }
  return out.reverse();
}
