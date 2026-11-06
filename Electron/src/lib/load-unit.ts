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
