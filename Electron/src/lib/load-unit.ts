// Yük birimi (çuvalsız sevk) — sunucu `Sack.unitKind` aynası. Alan yoksa (eski sunucu) ÇUVAL sayılır.
export type LoadUnitKind = "SACK" | "CART" | "BULK";

export interface LoadUnitLike {
  sackNo?: string | number | null;
  unitKind?: LoadUnitKind | null;
  unitLabel?: string | null;
}

export function isLooseUnit(u: LoadUnitLike): boolean {
  return u.unitKind === "BULK" || u.unitKind === "CART";
}

/** Birim adı: "Dökme" · "Araba A-12" · çuval no. */
export function loadUnitTitle(u: LoadUnitLike): string {
  if (u.unitKind === "BULK") return "Dökme";
  if (u.unitKind === "CART") return `Araba ${u.unitLabel ?? "?"}`;
  return String(u.sackNo ?? "");
}

/**
 * Yük birimi özeti: "3 çuval" · "2 araba" · "Dökme" · karışık "1 çuval · 2 araba". `total` sunucunun TÜM canlı
 * birim sayısıdır (çuval+araba+dökme); araba/dökme alanı yoksa (eski sunucu) hepsi çuval sayılır.
 */
export function loadUnitsText(total: number, carts?: number | null, bulks?: number | null): string {
  const c = carts ?? 0;
  const b = bulks ?? 0;
  const sacks = Math.max(0, total - c - b);
  const parts: string[] = [];
  if (sacks > 0) parts.push(`${sacks} çuval`);
  if (c > 0) parts.push(`${c} araba`);
  if (b > 0) parts.push("Dökme");
  return parts.length > 0 ? parts.join(" · ") : "0 çuval";
}

/** Kg yalnız çuvallarındır (dökme/araba tartılmaz): çuvalsız yükte boş, karışıkta "(çuvallar)" eki. */
export function loadKgSuffix(total: number, carts?: number | null, bulks?: number | null): "none" | "sacks-only" | "all" {
  const loose = (carts ?? 0) + (bulks ?? 0);
  if (loose === 0) return "all";
  return total - loose > 0 ? "sacks-only" : "none";
}

/** Detay özet kutusu: "3 çuval · 96,7 kg" · "2 araba" · "1 çuval · 2 araba · 12 kg (çuvallar)". `kg` biçimli metin. */
export function loadSummaryValue(total: number, kg: string, carts?: number | null, bulks?: number | null): string {
  const units = loadUnitsText(total, carts, bulks);
  const suffix = loadKgSuffix(total, carts, bulks);
  if (suffix === "none") return units;
  return `${units} · ${kg} kg${suffix === "sacks-only" ? " (çuvallar)" : ""}`;
}
