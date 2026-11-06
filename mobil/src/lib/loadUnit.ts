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

/** Dökme/araba sevkiyattan tek başına çıkarılamaz (sunucu 409) — yolu sevkiyat iptalidir. */
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
  if ((sh.cartCount ?? 0) > 0) parts.push(`${sh.cartCount} araba`);
  if ((sh.bulkCount ?? 0) > 0) parts.push('Dökme');
  return parts.length > 0 ? parts.join(' · ') : 'Yük yok';
}
