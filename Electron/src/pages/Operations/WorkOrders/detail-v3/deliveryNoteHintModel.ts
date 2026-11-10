// Gelen belge ipucunun NE ZAMAN ve NE söyleyeceği — saf (JSX'siz). Kutu yalnız eyleme değer bir şey varsa çizilir:
// hedef yokken öneri (Uygula) · belgeden çözülen değer hedeften FARKLI (çelişki) · belgeler birden çok değere çözülüyor (liste).
// Hedef var + belge hedefle aynı ya da hiçbir şey çözülemedi → sessiz (kullanıcı 2026-11-10: "bu ne demek").
import type { DeliveryNoteGramajSuggestion, VariantTarget } from "@/lib/kursun-gramaj";

type Entry = DeliveryNoteGramajSuggestion["entries"][number];
type Value = { valueId: string; valueName: string };

export type GramajHintView =
  | { kind: "apply"; value: Value }
  | { kind: "conflict"; doc: Value; targetName: string; applicable: boolean }
  | { kind: "list"; entries: Entry[] };

export type VariantHintRow =
  | { kind: "suggest"; propertyId: string; propertyName: string; value: Value }
  | { kind: "conflict"; propertyId: string; propertyName: string; doc: Value; targetName: string }
  | { kind: "list"; propertyId: string; propertyName: string; entries: Entry[] };

function resolvedValues(entries: readonly Entry[]): Value[] {
  const seen = new Map<string, Value>();
  for (const e of entries) if (e.valueId && !seen.has(e.valueId)) seen.set(e.valueId, { valueId: e.valueId, valueName: e.valueName ?? "" });
  return [...seen.values()];
}

/** Tek özellik için karar; `target` = o özelliğin İE'deki aktif hedefi (yoksa null). */
function decide(
  suggested: Value | null,
  entries: readonly Entry[],
  target: { valueId: string; valueName: string } | null,
): { kind: "apply"; value: Value } | { kind: "conflict"; doc: Value; full: boolean } | { kind: "list" } | null {
  const resolved = resolvedValues(entries);
  if (resolved.length >= 2) return { kind: "list" };
  if (!target) {
    if (suggested) return { kind: "apply", value: suggested };
    // Kısmi çözüm (bir değer + okunamayanlar) hedefsiz İE'de liste olarak bilgi verir; öneri sayılmaz.
    return resolved.length === 1 ? { kind: "list" } : null;
  }
  const doc = suggested ?? resolved[0] ?? null;
  if (!doc || doc.valueId === target.valueId) return null;
  return { kind: "conflict", doc, full: suggested !== null };
}

export function gramajHintView(
  s: DeliveryNoteGramajSuggestion,
  target: { valueId: string; valueName: string } | null,
): GramajHintView | null {
  const d = decide(s.suggested, s.entries, target);
  if (!d) return null;
  if (d.kind === "apply") return d;
  if (d.kind === "list") return { kind: "list", entries: s.entries };
  // Uygula yalnız bütün kapsanan kökler aynı değerdeyse (tam öneri) — kısmi çözüm hedefi ezmez.
  return { kind: "conflict", doc: d.doc, targetName: target!.valueName, applicable: d.full };
}

/** Kurşun dışı çeşitler (brode deseni vb.) aynı kuralla; satır yalnız öneri/çelişki/çoklu değer varsa. */
export function variantHintRows(s: DeliveryNoteGramajSuggestion, targets: readonly VariantTarget[]): VariantHintRow[] {
  const rows: VariantHintRow[] = [];
  for (const v of s.variants ?? []) {
    const t = targets.find((x) => x.propertyId === v.propertyId) ?? null;
    const d = decide(v.suggested, v.entries, t);
    const base = { propertyId: v.propertyId, propertyName: v.propertyName };
    if (!d) continue;
    if (d.kind === "apply") rows.push({ kind: "suggest", ...base, value: d.value });
    else if (d.kind === "conflict") rows.push({ kind: "conflict", ...base, doc: d.doc, targetName: t!.valueName });
    else if (resolvedValues(v.entries).length >= 2) rows.push({ kind: "list", ...base, entries: v.entries });
  }
  return rows;
}
