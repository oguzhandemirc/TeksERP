// Yük birimi (çuvalsız sevk) — sunucu `Sack.unitKind` aynası. Alan yoksa (eski sunucu) ÇUVAL sayılır.
export type LoadUnitKind = 'SACK' | 'CART' | 'BULK';

export interface LoadUnitLike {
  sackNo?: string | null;
  seq?: number | null;
  unitKind?: LoadUnitKind | null;
  unitLabel?: string | null;
}

/** Operatörün gördüğü birim adı: "Dökme" · "Araba A-12" · çuval no. */
export function loadUnitTitle(u: LoadUnitLike): string {
  if (u.unitKind === 'BULK') return 'Dökme';
  if (u.unitKind === 'CART') return `Araba ${u.unitLabel ?? '?'}`;
  return u.sackNo || (u.seq != null ? `#${u.seq}` : 'Çuval');
}

/** Dökme/araba birimi: tartı taşımaz; sevkiyattan birim olarak çıkarılmaz, topları tek tek çıkarılır (son top birimi düşürür). */
export function isLooseUnit(u: LoadUnitLike): boolean {
  return u.unitKind === 'BULK' || u.unitKind === 'CART';
}

/** Birim ikonu (MaterialCommunityIcons). */
export function loadUnitIcon(u: LoadUnitLike): string {
  if (u.unitKind === 'BULK') return 'truck-cargo-container';
  if (u.unitKind === 'CART') return 'dolly';
  return 'sack';
}

export interface BoardUnitCounts {
  sackCount: number;
  cartCount?: number;
  bulkCount?: number;
  /** Canlı araba no'ları (yeni sunucu) — "Araba A-12" yazılır; yoksa "N araba". */
  cartLabels?: string[];
}

/** Araba parçası: no'lar biliniyorsa "Araba A-12" / "Araba A-1, A-2"; çok ya da bilinmiyorsa "N araba". */
function cartPart(sh: BoardUnitCounts): string {
  const n = sh.cartCount ?? 0;
  const labels = sh.cartLabels ?? [];
  if (labels.length === n && n > 0 && n <= 3) return `Araba ${labels.join(', ')}`;
  return `${n} araba`;
}

/** Karttaki çuval birimi sayısı — "Çuval Çıkar" yalnız bu > 0 iken anlamlıdır (dökme/araba çıkarılamaz). */
export function boardSackUnits(sh: BoardUnitCounts): number {
  return Math.max(0, sh.sackCount - (sh.cartCount ?? 0) - (sh.bulkCount ?? 0));
}

/** Sevk kapısı kartının yük özeti: "3 çuval" · "Dökme" · "2 araba" · "2 çuval · 1 araba". Eski sunucu türleri göndermez → hepsi çuval. */
export function boardUnitText(sh: BoardUnitCounts): string {
  const sacks = boardSackUnits(sh);
  const parts: string[] = [];
  if (sacks > 0) parts.push(`${sacks} çuval`);
  if ((sh.cartCount ?? 0) > 0) parts.push(cartPart(sh));
  if ((sh.bulkCount ?? 0) > 0) parts.push('Dökme');
  return parts.length > 0 ? parts.join(' · ') : 'Yük yok';
}

/**
 * Yük kg metni: dökme/araba tartılmaz. Yalnız çuvallı → "96,7 kg"; karışıkta kg yalnız çuvallarındır →
 * "96,7 kg (çuvallar)"; çuval yoksa ya da kg 0 ise boş (tartılmış gibi "0 kg" yazılmaz).
 */
export function loadKgText(sh: BoardUnitCounts & { totalKg: number }): string {
  if (!(sh.totalKg > 0) || boardSackUnits(sh) === 0) return '';
  const kg = `${sh.totalKg.toLocaleString('tr-TR')} kg`;
  return (sh.cartCount ?? 0) + (sh.bulkCount ?? 0) > 0 ? `${kg} (çuvallar)` : kg;
}
