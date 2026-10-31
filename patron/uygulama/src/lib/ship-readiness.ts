// İş emri sevke hazırlığı görünümü (D4-J5): `is-emri.sevkeHazir` fabrikadan gelir; uygulama yalnız etiketler,
// sınıflamaz ve sayı türetmez. Alan yoksa (eski fabrika), null ya da YOK ise rozet yok.
import { SHIP_READINESS_LABELS } from "../api/wire";
import { formatNumber } from "./format";

export type ShipReadinessView = { readonly kind: "iyi" | "uyari"; readonly label: string; readonly text: string } | null;

export function shipReadinessView(kayit: Readonly<Record<string, unknown>>): ShipReadinessView {
  const v = kayit.sevkeHazir;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const label = typeof o.durum === "string" ? SHIP_READINESS_LABELS[o.durum] : undefined;
  if (!label) return null;
  return { kind: o.durum === "HAZIR" ? "iyi" : "uyari", label, text: `${label}: ${formatNumber(o.hazirTop, 0)} top · ${formatNumber(o.hazirMetre, 0)} m` };
}
