// Hizmet Fiyat Tablosu — saf kurallar (React'siz; bileşen ve test aynı kodu koşar).
import { addDaysToKey, factoryDayKey, factoryDayStartIso } from "@/lib/factory-time";
import type { ServicePriceSource, ServicePriceTierRow } from "./service";

/** Kaynak rozeti: kısa ad + açıklama + ton. Sıra = fatura çözüm sırası (K1). */
export const SOURCE_BADGE: Record<ServicePriceSource, { label: string; hint: string; className: string }> = {
  CUSTOMER_TIER: {
    label: "Müşteri kademe",
    hint: "Bu müşteriye özel kademe fiyatı (1. sıra)",
    className: "bg-primary/15 text-primary border-primary/30",
  },
  CUSTOMER_GRAM: {
    label: "Müşteri gram",
    hint: "Müşteri cari kartındaki gram fiyatı × gramaj (2. sıra)",
    className: "bg-info/15 text-info border-info/30",
  },
  TIER: {
    label: "Genel kademe",
    hint: "Tablodaki genel kademe fiyatı (3. sıra)",
    className: "bg-success/15 text-success border-success/30",
  },
  STATION_GRAM: {
    label: "İstasyon gram",
    hint: "İstasyondaki gram fiyatı × gramaj (4. sıra)",
    className: "bg-muted text-muted-foreground border-border",
  },
  ITEM: {
    label: "Kalem fiyatı",
    hint: "Hizmetin kademe ayrımsız fiyatı (son sıra)",
    className: "bg-muted text-muted-foreground border-border",
  },
};

/** Türkçe ondalık girişi: "12,5" / "12.5" / "1.234,50" → sayı; boş → null; geçersiz/negatif → NaN. */
export function parsePriceInput(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** Ekranda fiyat: 4 haneye kadar, Türkçe biçim. */
export function formatPrice(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** İleri tarih seçicisinin en erken günü: yarın (bugünün başı geçmiştir; backend geçmiş `validFrom`u 400 ile reddeder). */
export function minFutureDayKey(now: Date = new Date()): string {
  return addDaysToKey(factoryDayKey(now), 1);
}

/** Yürürlük seçimi → gövde: boş = hemen (null), gün anahtarı = o fabrika gününün başı. */
export function validFromPayload(dayKey: string | null): string | null {
  return dayKey ? factoryDayStartIso(dayKey) : null;
}

export type EditScope = "general" | "customer";
export const cellKey = (valueId: string | null, scope: EditScope): string => `${valueId ?? "item"}:${scope}`;

/** Klavye gezintisi: aynı kolonda bir alt/üst satır (sınırda durur). */
export function nextRowIndex(index: number, delta: 1 | -1, count: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(count - 1, 0));
}

/** "Gram fiyatından doldur" adayı: gramajı olan, genel fiyatı olmayan, gram formülü çıkan kademe. */
export interface GramFillCandidate {
  valueId: string;
  name: string;
  amount: string;
  price: number;
  formula: string;
}

/**
 * Önizleme listesi: tabloda genel kademe fiyatı (güncel ya da bekleyen) OLMAYAN ve etkin fiyatı gramdan gelen
 * kademeler. Var olan fiyat EZİLMEZ — kullanıcı satır satır seçer.
 */
export function gramFillCandidates(tiers: ServicePriceTierRow[]): GramFillCandidate[] {
  return tiers
    .filter((t) => t.mapped && t.isActive && t.amount && !t.general.current && !t.general.pending)
    .filter(
      (t) =>
        (t.effective.source === "STATION_GRAM" || t.effective.source === "CUSTOMER_GRAM") &&
        t.effective.price &&
        t.effective.gramFormula,
    )
    .map((t) => ({
      valueId: t.valueId,
      name: t.name,
      amount: t.amount as string,
      price: Number(t.effective.price),
      formula: t.effective.gramFormula as string,
    }));
}

/** Satır durumu: K5 (tabloda yok → fiyatsız) · fiyatlı · hiç fiyat yok. */
export function tierStatus(t: ServicePriceTierRow): "MISSING" | "PRICED" | "UNPRICED" {
  if (t.effective.tierMissing) return "MISSING";
  return t.effective.price ? "PRICED" : "UNPRICED";
}
