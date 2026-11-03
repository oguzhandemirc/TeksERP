import type { FabricProperty } from "./types";

/** Sunucu ağaç sırası (K21): çeşit ebeveyninin hemen altında, bağlam satırlarıyla. */
export const HIERARCHY_SORT = "hierarchy";

/** Ebeveynin çeşitleri — şema bugün tek çeşide izin verir, gösterim liste olarak kalır. */
export function variantsOf(row: Pick<FabricProperty, "variant">): NonNullable<FabricProperty["variant"]>[] {
  return row.variant ? [row.variant] : [];
}

/** Daraltılmış ebeveynin çeşit satırı — ekranda yok. */
function isHiddenVariant(row: FabricProperty, collapsed: ReadonlySet<string>): boolean {
  return row.listLevel === 1 && !!row.variantOfPropertyId && collapsed.has(row.variantOfPropertyId);
}

/** Satır sınıfı: daraltılmış ebeveynin çeşidi gizli, bağlam satırı soluk. */
export function hierarchyRowClass(row: FabricProperty, collapsed: ReadonlySet<string>): string | undefined {
  if (isHiddenVariant(row, collapsed)) return "hidden";
  return row.listContext ? "opacity-50" : undefined;
}

/** Seçilebilir satır: gizli çeşit "tümünü seç"e girmez (birleştir/sil görünmeyeni kapsamasın). */
export function hierarchyRowSelectable(row: FabricProperty, collapsed: ReadonlySet<string>): boolean {
  return !isHiddenVariant(row, collapsed);
}

const BACK_UNROUND = "aıAI";
const FRONT_UNROUND = "eiEİ";
const BACK_ROUND = "ouOU";
const VOWELS = `${BACK_UNROUND}${FRONT_UNROUND}${BACK_ROUND}öüÖÜ`;

/** Türkçe tamlayan eki (ünlü uyumu): Kurşunlu → Kurşunlu'nun, Yanmazlık → Yanmazlık'ın. */
export function genitive(name: string): string {
  const trimmed = name.trim();
  const last = [...trimmed].reverse().find((c) => VOWELS.includes(c));
  if (!last) return `${trimmed}'in`;
  const vowel = BACK_UNROUND.includes(last) ? "ı" : FRONT_UNROUND.includes(last) ? "i" : BACK_ROUND.includes(last) ? "u" : "ü";
  const endsWithVowel = VOWELS.includes(trimmed.at(-1) ?? "");
  return `${trimmed}'${endsWithVowel ? "n" : ""}${vowel}n`;
}
