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
