// =============================================================================
// YAŞLANAN STOK KOŞUL KAYNAĞI — `stok.yaslanan` (KOSUL, kullanıcı kararı 2026-11-14)
// =============================================================================
// Yüklem KOPYALANMAZ: küme + yaş çıpası `helpers/stock-aging.helper.ts#loadAgedStockGroups`. Eşik katalog
// `paramSemasi.gun` (varsayılan 30) ⊕ fabrika (`effectiveNotificationParams`); çıpa kipi `bildirim.stokYaslanan.kaynak`.
// Konu depo başına; yük adet + metre + gün, TUTAR yok. Defter girişi olmayan top durum tarihinden sayılır ve
// `yasKaynagi` metninde adediyle yazılır. `evaluate` fırlatırsa motor hiçbir koşulu kapatmaz (fail-closed).
// =============================================================================
import prisma from "../../lib/prisma";
import type { NotificationKind } from "../../constants/notification-catalog";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { loadAgedStockGroups, type AgedStockGroup } from "../helpers/stock-aging.helper";
import { readStockAgingSource } from "../system-setting.service";
import type { StockAgingSource } from "../system-setting/defaults";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const STOCK_AGING_KIND = "stok.yaslanan" satisfies NotificationKind;
const PERIOD_MS = 1_800_000;
const DAY_MS = 86_400_000;

export interface StockAgingDeps {
  now: () => Date;
  source: () => Promise<StockAgingSource>;
  /** Bekçi körlük zemini: yalnız bu depolar (üretimde tanımsız = tüm depolar). */
  warehouseIds?: readonly string[];
}

const REAL_DEPS: Readonly<StockAgingDeps> = { now: () => new Date(), source: () => readStockAgingSource() };
let deps: StockAgingDeps = { ...REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideStockAgingDeps(p: Partial<StockAgingDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

/** Yaş kaynağının görünen açıklaması — düşülen top varsa adediyle (sessiz tahmin yok). */
export function ageSourceLabel(source: StockAgingSource, fallbackCount: number): string {
  if (source === "durum-degisimi") return "son durum değişiminden";
  if (fallbackCount === 0) return "depoya girişten";
  return `depoya girişten; ${fallbackCount} topta giriş hareketi yok, durum tarihinden`;
}

export function toSubject(g: AgedStockGroup, source: StockAgingSource, days: number): ConditionSubject {
  return {
    key: g.warehouseId, type: "depo", id: g.warehouseId,
    payload: {
      depoId: g.warehouseId, depoAd: g.warehouseName, adet: g.rollCount, gun: days,
      metre: Math.round(g.meters * 10) / 10, yasKaynagi: ageSourceLabel(source, g.fallbackCount),
    },
  };
}

export async function agedStockSubjects(): Promise<ConditionSubject[]> {
  const days = Number(effectiveNotificationParams(STOCK_AGING_KIND).gun);
  const source = await deps.source();
  const cutoff = new Date(deps.now().getTime() - days * DAY_MS);
  const groups = await loadAgedStockGroups(prisma, { source, cutoff, warehouseIds: deps.warehouseIds });
  return groups.map((g) => toSubject(g, source, days));
}

export function registerStockAgingConditionSource(): void {
  registerConditionSource({ kind: STOCK_AGING_KIND, periodMs: PERIOD_MS, evaluate: () => agedStockSubjects() });
}
