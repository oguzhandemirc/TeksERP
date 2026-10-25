// =============================================================================
// Kod modu — ölçü/boyut/küp kimliği tamamlama (YALNIZ katalog ucunun döndürdüğü kimlikler)
// =============================================================================
// Katalog `/api/rapor-semantik/katalog` kullanıcının izniyle SUNUCUDA süzülür; burada liste uydurulmaz,
// sabit kimlik yazılmaz. Konum ağaçtan okunur: `olculer[n]` → ölçü, `boyutlar[n]`/`field`/`boyut` → boyut, `kup` → küp.
// =============================================================================
import type { EditorState } from "@codemirror/state";
import type { CatalogCube } from "../custom-api";
import { findProperty, fullTree, keyText, pathOfNode, propertyValue, type SyntaxNode } from "./json-tree";

export type SlotKind = "measure" | "dimension" | "cube";

export interface IdOption {
  label: string;
  detail: string;
  info?: string;
}

export interface CompletionAt {
  from: number;
  to: number;
  kind: SlotKind;
  options: IdOption[];
}

const DIMENSION_KEYS = new Set(["field", "boyut", "satir", "sutun"]);

/** Dizgenin yolundan yuvanın türü; tanınmayan yerde tamamlama yok. */
export function slotKind(path: ReadonlyArray<string | number>): SlotKind | null {
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  if (typeof last === "number" && prev === "olculer") return "measure";
  if (typeof last === "number" && prev === "boyutlar") return "dimension";
  if (last === "kup") return "cube";
  if (typeof last === "string" && DIMENSION_KEYS.has(last)) return "dimension";
  return null;
}

/** Yuvanın ait olduğu sorgu nesnesindeki `kup` değeri (varsa) — önerileri o küple daraltır. */
function cubeOfSlot(state: EditorState, node: SyntaxNode): string | null {
  for (let n: SyntaxNode | null = node.parent; n; n = n.parent) {
    if (n.name !== "Object") continue;
    const prop = findProperty(state, n, "kup");
    const v = prop ? propertyValue(prop) : null;
    if (v?.name === "String") return keyText(state, v);
  }
  return null;
}

function uniqueByLabel(list: IdOption[]): IdOption[] {
  const seen = new Set<string>();
  return list.filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true)));
}

/** Katalogdan seçenekler; küp biliniyorsa yalnız o küpün kimlikleri. */
export function catalogOptions(cubes: readonly CatalogCube[], kind: SlotKind, cube: string | null): IdOption[] {
  if (kind === "cube") return cubes.map((c) => ({ label: c.kimlik, detail: c.ad }));
  const scope = cubes.filter((c) => c.kimlik === cube);
  const pool = scope.length ? scope : cubes;
  if (kind === "measure") return uniqueByLabel(pool.flatMap((c) => c.olculer.map((m) => ({ label: m.kimlik, detail: m.ad, info: m.aciklama || undefined }))));
  return uniqueByLabel(pool.flatMap((c) => c.boyutlar.map((d) => ({ label: d.kimlik, detail: d.ad }))));
}

/** İmleç bir kimlik dizgesinin içindeyse tamamlama aralığı + seçenekler. */
export function completionAt(state: EditorState, pos: number, cubes: readonly CatalogCube[]): CompletionAt | null {
  const node = fullTree(state).resolveInner(pos, -1);
  if (node.name !== "String" || pos <= node.from) return null;
  const kind = slotKind(pathOfNode(state, node));
  if (!kind) return null;
  const closed = node.to - node.from >= 2 && state.sliceDoc(node.to - 1, node.to) === '"';
  return { from: node.from + 1, to: closed ? node.to - 1 : node.to, kind, options: catalogOptions(cubes, kind, cubeOfSlot(state, node)) };
}
