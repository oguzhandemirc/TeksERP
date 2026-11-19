// =============================================================================
// FASONDAKİ İPLİK — saf katman: kırılım sırası, grup toplamı, özet, yaş (devere D6c)
// =============================================================================
// Süzme sunucuda; burada yalnız SIRALAMA ve görüntü türetimi var (uç sayfasız tüm kümeyi döndürür,
// sıralamak satır gizlemez). Bekçi: `model.test.ts`.
// =============================================================================
import { factoryDayDiff } from "@/lib/factory-time";
import type { YarnAtSubRow } from "./service";

export type YarnAtSubView = "subcontractor" | "yarn";

/** Durum süzgeci — `filter[status]` CSV değerleri. Devreden = kapanmış siparişten fasoncuda kalan. */
export const STATUS_OPTIONS = [
  { value: "OPEN,IN_PROGRESS", label: "Süren sipariş" },
  { value: "COMPLETED", label: "Devreden" },
] as const;

export const subLabel = (r: YarnAtSubRow) => r.subcontractorName ?? r.subcontractorCode ?? "Bilinmeyen fasoncu";
export const yarnLabel = (r: YarnAtSubRow) => r.yarnItemName ?? r.yarnItemCode ?? "Bilinmeyen iplik";

export const rowKey = (r: YarnAtSubRow) => `${r.subcontractorId}|${r.yarnItemId}|${r.lotId ?? ""}|${r.ownerCustomerId ?? ""}`;

const n = (s: string | number) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

export interface YarnAtSubLine extends YarnAtSubRow {
  /** Seçili kırılımın ana anahtarı (fasoncu ya da iplik kimliği). */
  groupId: string;
  groupLabel: string;
  /** Grubun ilk satırı mı — grup adı + toplamı yalnız burada basılır. */
  groupFirst: boolean;
  groupKg: number;
  groupLines: number;
  /** Kapanmış (COMPLETED) siparişlerden kalan kg. */
  carriedKg: number;
}

/** Kırılıma göre sırala (ana → ikincil → lot) ve grup başlarını işaretle. */
export function toLines(rows: readonly YarnAtSubRow[], view: YarnAtSubView): YarnAtSubLine[] {
  const main = view === "subcontractor" ? subLabel : yarnLabel;
  const second = view === "subcontractor" ? yarnLabel : subLabel;
  const mainId = (r: YarnAtSubRow) => (view === "subcontractor" ? r.subcontractorId : r.yarnItemId);
  const sorted = [...rows].sort(
    (a, b) =>
      main(a).localeCompare(main(b), "tr") ||
      mainId(a).localeCompare(mainId(b)) ||
      second(a).localeCompare(second(b), "tr") ||
      (a.lotNo ?? "").localeCompare(b.lotNo ?? "", "tr"),
  );
  const totals = new Map<string, { kg: number; lines: number }>();
  for (const r of sorted) {
    const t = totals.get(mainId(r)) ?? { kg: 0, lines: 0 };
    t.kg += n(r.kg);
    t.lines += 1;
    totals.set(mainId(r), t);
  }
  return sorted.map((r, i) => {
    const id = mainId(r);
    const t = totals.get(id) ?? { kg: 0, lines: 0 };
    return { ...r, groupId: id, groupLabel: main(r), groupFirst: !sorted[i - 1] || mainId(sorted[i - 1] as YarnAtSubRow) !== id, groupKg: t.kg, groupLines: t.lines, carriedKg: carriedKg(r) };
  });
}

export function carriedKg(r: YarnAtSubRow): number {
  return r.orders.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + n(o.kg), 0);
}

export interface YarnAtSubSummary {
  totalKg: number;
  subcontractorCount: number;
  yarnCount: number;
  carriedKg: number;
  /** En uzun süredir fasonda duran satırın gün sayısı (boşsa null). */
  oldestDays: number | null;
  /** Değer toplamı PARA BİRİMİ BAŞINA (kur çevrilmez; satır değerleri sunucunun) — fiyat alanı gelmediyse boş. */
  valueTotals: Array<{ currency: string; value: number }>;
  /** Fiyatı olmayan satır sayısı (lotsuz · fiyatsız · karışık para birimi) — toplamın eksik olduğunu söyler. */
  unpricedLines: number;
}

/** Tek terim: kapanmış siparişten fasoncuda kalan iplik (rozet · özet · dışa aktarım aynı kelime). */
export const CARRIED_LABEL = "devreden";
export const CARRIED_HINT = "Siparişi kapanmış ama fasoncuda kalan iplik — sonraki siparişe aktarılabilir ya da geri alınmalı";

/** Fiyatsız satırın sebebi — ekranda ipucu, dosyada metin. */
export function priceMissingText(r: YarnAtSubRow): string | null {
  switch (r.priceStatus) {
    case "NO_LOT": return "Lotsuz iplik — mal kabul fiyatı lota bağlıdır";
    case "NO_PRICE": return "Bu lotun mal kabulünde fiyat yok";
    case "MIXED_CURRENCY": return "Lotun mal kabulleri farklı para birimlerinde — tek fiyat verilemez";
    default: return null;
  }
}

/** Özet şeridi — listeyle AYNI yanıttan (tek where). */
export function summarize(rows: readonly YarnAtSubRow[], now: Date = new Date()): YarnAtSubSummary {
  let totalKg = 0;
  let carried = 0;
  let oldest: number | null = null;
  const values = new Map<string, number>();
  let unpriced = 0;
  for (const r of rows) {
    totalKg += n(r.kg);
    if (r.priceStatus !== undefined) {
      if (r.value != null && r.currency) values.set(r.currency, (values.get(r.currency) ?? 0) + n(r.value));
      else unpriced += 1;
    }
    carried += carriedKg(r);
    const d = ageDays(r.oldestDispatchedAt, now);
    if (oldest === null || d > oldest) oldest = d;
  }
  return {
    totalKg,
    subcontractorCount: new Set(rows.map((r) => r.subcontractorId)).size,
    yarnCount: new Set(rows.map((r) => r.yarnItemId)).size,
    carriedKg: carried,
    oldestDays: oldest,
    valueTotals: [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, value })),
    unpricedLines: unpriced,
  };
}

/** Fabrika günüyle kaç gündür fasonda (en eski sevkten bugüne). */
export function ageDays(iso: string, now: Date = new Date()): number {
  const d = factoryDayDiff(now, iso);
  return Number.isFinite(d) ? Math.max(0, d) : 0;
}

/** Uzun bekleme eşiği — görünür uyarı tonu (renk tek başına bilgi taşımaz; gün sayısı hep yazılır). */
export const LONG_WAIT_DAYS = 30;

export function ageText(days: number): string {
  return days === 0 ? "bugün" : `${days} gün`;
}
