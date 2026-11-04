import type { Tone } from "@/components/operations/StatusBadge";
import type { Order, OrderNeredeTone } from "./types";

/**
 * Siparişler "Nerede?" — panel tarafı SAF katman ("Sevk durumu" metni `order-cell-text.ts`).
 * Cümleyi SUNUCU kurar (NEREDE-SOZLESME §1); panel cümle KURMAZ, yalnız rengi
 * eşler. Hücre, Excel ve PDF aynı fonksiyondan okur (ekran ≠ dosya ayrışmasın).
 * Eski sunucuda (2.11.3-) alan yoktur → "—".
 */

export const NEREDE_TONES: Record<OrderNeredeTone, Tone> = {
  gray: "muted",
  blue: "info",
  orange: "warning",
  green: "success",
};

export function neredeTone(tone: OrderNeredeTone | undefined): Tone {
  return (tone && NEREDE_TONES[tone]) ?? "neutral";
}

/** Excel/PDF "Nerede?" hücresi: ekrandaki rozet metni + varsa kırmızı ek rozet. */
export function neredeExportText(order: Pick<Order, "nerede">): string {
  const n = order.nerede;
  if (!n) return "—";
  return n.overdueText ? `${n.text} · ${n.overdueText}` : n.text;
}

// ── Hızlı sekmeler ─────────────────────────────────────────────────────────
// Süzme SUNUCUDA: sekme yalnız URL'e `filter[nerede]` yazar (Tümü = anahtar yok).
export const NEREDE_FILTER_KEY = "filter[nerede]";
export const FASON_FIRMA_KEY = "filter[fasonFirma]";
export const FASON_GUN_KEY = "filter[fasonGun]";

export type NeredeTabValue = "BEKLEYEN" | "FASONDA" | "SEVKE_HAZIR" | "KISMEN" | "GECIKEN";

export interface NeredeTab {
  value: NeredeTabValue | null;
  label: string;
  /** Üretim modülü kapalı kurulumda düşer (fason/depo kavramı yok). */
  production?: boolean;
}

export const NEREDE_TABS: readonly NeredeTab[] = [
  { value: null, label: "Tümü" },
  { value: "BEKLEYEN", label: "Bekleyenler" },
  { value: "FASONDA", label: "Fasonda", production: true },
  { value: "SEVKE_HAZIR", label: "Sevke hazır", production: true },
  { value: "KISMEN", label: "Kısmen gidenler" },
  { value: "GECIKEN", label: "Gecikenler" },
];

export function neredeTabs(productionEnabled: boolean): NeredeTab[] {
  return NEREDE_TABS.filter((t) => productionEnabled || !t.production);
}

/** URL değerinden etkin sekme; tanınmayan değer "Tümü" görünür (sunucu zaten 400 verir). */
export function activeNeredeTab(raw: string | null): NeredeTabValue | null {
  return NEREDE_TABS.find((t) => t.value !== null && t.value === raw)?.value ?? null;
}

/**
 * "Fasonda X günden uzun" girişi → URL değeri. Sunucu 0..3650 tam sayıyı kabul
 * eder (dışı 400); boş/geçersiz girdi süzgeci KALDIRIR (null), istek 400'e düşmez.
 */
export function normalizeFasonGun(input: string): string | null {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (n > 3650) return null;
  return String(n);
}
