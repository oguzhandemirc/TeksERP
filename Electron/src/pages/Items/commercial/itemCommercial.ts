// Ürün kartı "Ticari" sekmesi — saf katman (D4 aşama a). Sekme SALT OKUNUR: fiyat, tedarikçi kodu ve kalite şartı
// kendi ekranlarında yazılır (fiyat sürümlü ayardır, tek yazım yeri Kalem Fiyatları); burada özet + "… ekranında aç".
import { CURRENCIES, type Currency, type DecimalLike, type ItemPriceRow, type PriceKind } from "@/pages/Definitions/ItemPrices/service";

export interface PriceSummaryLine {
  kind: PriceKind;
  currency: Currency;
  /** Kart varsayılanı; `null` = varsayılan girilmemiş (yalnız müşteri istisnası var). */
  defaultPrice: DecimalLike | null;
  /** Müşteriye özel fiyat sayısı. */
  exceptions: number;
}

const KIND_ORDER: PriceKind[] = ["SALE", "PURCHASE"];

/** Fiyat satırları → (yön, para birimi) başına varsayılan + istisna sayısı; satış önce, para birimi sabit sırada. */
export function summarizeItemPrices(rows: readonly ItemPriceRow[]): PriceSummaryLine[] {
  const map = new Map<string, PriceSummaryLine>();
  for (const r of rows) {
    const key = `${r.kind}:${r.currency}`;
    const line = map.get(key) ?? { kind: r.kind, currency: r.currency, defaultPrice: null, exceptions: 0 };
    if (r.customerId === null) line.defaultPrice = r.price;
    else line.exceptions += 1;
    map.set(key, line);
  }
  return [...map.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency),
  );
}

export interface CommercialAccess {
  /** Kalem fiyatı okunabilir (ticaret modülü + `item:read`). */
  prices: boolean;
  /** Tedarikçi kalem kodları (ticaret + mal kabul okuma) — yalnız iplikte anlamlı. */
  supplierCodes: boolean;
  /** Müşteri lab şartı (kalite güvence + `certificate:read` + `labtest:read`) — yalnız kumaşta. */
  labSpecs: boolean;
  /** 4 puan kural seti (kalite güvence + `inspection:read`) — yalnız kumaşta. */
  ruleSets: boolean;
}

/** Bu kartta hangi bölümler çizilir — tip + erişim. Hiçbiri yoksa sekme hiç çizilmez. */
export function commercialSections(itemType: string, a: CommercialAccess): CommercialAccess {
  const fabric = itemType === "FABRIC";
  return {
    prices: a.prices,
    supplierCodes: a.supplierCodes && itemType === "YARN",
    labSpecs: a.labSpecs && fabric,
    ruleSets: a.ruleSets && fabric,
  };
}

export const anyCommercialSection = (s: CommercialAccess): boolean => s.prices || s.supplierCodes || s.labSpecs || s.ruleSets;

const specNum = (v: string | number | null) => (v === null || v === "" ? null : String(v).replace(".", ","));

/** Lab şartı aralığı: "12 – 18 N" · "≥ 12 N" · "≤ 18 N" · sınırsızsa "—". */
export function specRangeText(s: { specMin: string | number | null; specMax: string | number | null; testType: { unit: string | null } }): string {
  const lo = specNum(s.specMin), hi = specNum(s.specMax), unit = s.testType.unit ? ` ${s.testType.unit}` : "";
  if (lo && hi) return `${lo} – ${hi}${unit}`;
  if (lo) return `≥ ${lo}${unit}`;
  if (hi) return `≤ ${hi}${unit}`;
  return "—";
}

/** Hedef ekran yolları — sekme deposuyla açılır (ürün penceresi ve altındaki form korunur). */
export const COMMERCIAL_PATHS = {
  prices: (itemId: string) => `/definitions/item-prices?itemId=${encodeURIComponent(itemId)}`,
  labSpecs: "/quality/certificates?tab=specs",
  ruleSets: "/quality/inspection-rules",
} as const;

export function openScreenTab(path: string): void {
  // Sekme deposu tembel: statik import bütün rota ağacını ürün penceresine bağlardı (emsal `open-weft-specs.ts`).
  void import("@/store/tabs").then((m) => m.useTabsStore.getState().openTab(path, { forceNew: true }));
}
