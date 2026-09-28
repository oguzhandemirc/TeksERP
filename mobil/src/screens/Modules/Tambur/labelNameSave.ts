// =============================================================================
// Etiketteki adın "kalıcı" düzeltmesi — hangi satıra yazılır, rozet ne der
// =============================================================================
// Saf ve ayrı dosyada (labelNameCompare emsali): kural bileşende kalsaydı test ya
// RN render'ı isterdi ya da kuralın kopyasını sınardı.
// =============================================================================
import type { ColorNameScope, NameSource } from '../../../types/models';

export interface PermanentTarget {
  customerId: string | null;
  itemId: string;
  /** Şu an basılan (zincirin çözdüğü) adlar — değişip değişmediği buna göre. */
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorNameScope?: ColorNameScope | null;
}

export type PermanentWrite =
  | { kind: 'ITEM_ALIAS'; customerId: string; itemId: string; alias: string }
  | { kind: 'ITEM_COLOR_ALIAS'; customerId: string; itemId: string; colorId: string; alias: string }
  | { kind: 'COLOR_ALIAS'; customerId: string; colorId: string; alias: string };

/**
 * "Bu müşteride hep" kaydının yazacağı satırlar.
 *
 * Yalnız DEĞİŞEN alan yazılır: çözülmüş ad kumaşa özel olabilir ve dokunulmamış
 * renk alanını genel ada yazmak onu müşterinin bütün kumaşlarına sızdırırdı.
 * Renk o anda KAZANAN kademeye yazılır (`ITEM` → kumaşa özel, aksi hâlde genel);
 * boş değer gönderilmez (adı silmek panelin işi).
 */
export function planPermanentWrites(
  p: PermanentTarget,
  input: { itemName: string; colorName: string },
): PermanentWrite[] {
  if (!p.customerId) return [];
  const nextItem = input.itemName.trim();
  const nextColor = input.colorName.trim();
  const out: PermanentWrite[] = [];
  if (nextItem && nextItem !== p.itemName.trim()) {
    out.push({ kind: 'ITEM_ALIAS', customerId: p.customerId, itemId: p.itemId, alias: nextItem });
  }
  if (nextColor && p.colorId && nextColor !== (p.colorName ?? '').trim()) {
    out.push(
      p.colorNameScope === 'ITEM'
        ? { kind: 'ITEM_COLOR_ALIAS', customerId: p.customerId, itemId: p.itemId, colorId: p.colorId, alias: nextColor }
        : { kind: 'COLOR_ALIAS', customerId: p.customerId, colorId: p.colorId, alias: nextColor },
    );
  }
  return out;
}

/** Ad kaynağının operatöre görünen karşılığı (kumaş satırı). */
export function sourceLabel(src: NameSource | null): string {
  if (src === 'OVERRIDE') return 'siparişe özel';
  if (src === 'MASTER') return 'müşteri adı';
  return 'bizdeki ad';
}

/** Renk satırının rozeti — kademe yalnız `ITEM` iken ayrılır, bilinmeyen değer müşteri adıdır. */
export function colorSourceLabel(src: NameSource | null, scope?: ColorNameScope | null): string {
  if (src === 'MASTER' && scope === 'ITEM') return 'müşteri adı · bu kumaşa özel';
  return sourceLabel(src);
}

/**
 * Önizleme satırının kaynak özeti. Renk rozeti kumaşınkinden farklıysa yanına
 * eklenir; aynıysa tekrar yazmak gürültüdür.
 */
export function sourceSummary(p: {
  itemNameSource: NameSource;
  colorName: string | null;
  colorNameSource: NameSource | null;
  colorNameScope?: ColorNameScope | null;
}): string {
  const item = sourceLabel(p.itemNameSource);
  if (!p.colorName || !p.colorNameSource) return item;
  const color = colorSourceLabel(p.colorNameSource, p.colorNameScope);
  return color === item ? item : `${item} · renk: ${color}`;
}
