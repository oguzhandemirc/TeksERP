// 400 COST_INPUT_MISSING `details.missing[]` → ekranda hangi alan/bağlantı işaretlenecek. Hesap değil, yönlendirme.
export type MissingTarget =
  | { kind: "field"; field: "fx" | "loomRpm" | "weftLengthCm" | "finishingRateCode" }
  | { kind: "link"; to: string; label: string };

const TARGETS: Record<string, MissingTarget> = {
  FX_RATE_MISSING: { kind: "field", field: "fx" },
  RPM_MISSING: { kind: "field", field: "loomRpm" },
  WEFT_LENGTH_MISSING: { kind: "field", field: "weftLengthCm" },
  FINISHING_RATE_MISSING: { kind: "field", field: "finishingRateCode" },
  PARAMETER_SET_MISSING: { kind: "link", to: "/cost/parameters", label: "Maliyet Parametreleri" },
  PICK_RATE_MISSING: { kind: "link", to: "/cost/parameters", label: "Maliyet Parametreleri" },
  YARN_PRICE_MISSING: { kind: "link", to: "/cost/yarn-prices", label: "İplik Maliyet Fiyatları" },
  WARP_SPEC_MISSING: { kind: "link", to: "/definitions/items", label: "Ürün kartı" },
  WEFT_SPEC_MISSING: { kind: "link", to: "/definitions/items", label: "Ürün kartı" },
  TAKEUP_MISSING: { kind: "link", to: "/definitions/warp-specs", label: "Çözgü kartı" },
  DENIER_MISSING: { kind: "link", to: "/definitions/items", label: "İplik kartı" },
  PICKS_MISSING: { kind: "link", to: "/definitions/items", label: "Atkı kartı" },
};

export function missingTarget(code: string): MissingTarget | null {
  return TARGETS[code] ?? null;
}

/** Eksik listesinde işaretlenecek form alanları (kur, devir, atkı boyu, tarife). */
export function missingFields(codes: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const c of codes) {
    const t = TARGETS[c];
    if (t?.kind === "field") out.add(t.field);
  }
  return out;
}
