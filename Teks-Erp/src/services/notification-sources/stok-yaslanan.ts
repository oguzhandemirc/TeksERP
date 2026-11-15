// =============================================================================
// YAŞLANAN STOK KOŞUL KAYNAĞI — `stok.yaslanan` (KOSUL, kullanıcı kararı 2026-11-14)
// =============================================================================
// Yüklem KOPYALANMAZ: küme + yaş çıpası `helpers/stock-aging.helper.ts#loadAgedStockGroups`. Eşik katalog
// `paramSemasi.gun` (varsayılan 30) ⊕ fabrika (`effectiveNotificationParams`); çıpa kipi `bildirim.stokYaslanan.kaynak`,
// top kapsamı `bildirim.stokYaslanan.kapsam` (`raf` = Stok & Ölü Stok raf kümesi; metinde "kapsam: raf|tümü").
// Konu depo başına (depo kolonu boş toplar "Depo atanmamış" grubunda, anahtar `depo-atanmamis`); yük adet + metre + gün, TUTAR yok. Defter girişi olmayan top durum tarihinden sayılır ve
// `yasKaynagi` metninde adediyle yazılır. `evaluate` fırlatırsa motor hiçbir koşulu kapatmaz (fail-closed).
// =============================================================================
import prisma from "../../lib/prisma";
import type { NotificationKind } from "../../constants/notification-catalog";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { loadAgedStockGroups, type AgedStockGroup } from "../helpers/stock-aging.helper";
import { readEmanetEnabled, readStockAgingScope, readStockAgingSource } from "../system-setting.service";
import type { StockAgingScope, StockAgingSource } from "../system-setting/defaults";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const STOCK_AGING_KIND = "stok.yaslanan" satisfies NotificationKind;
const PERIOD_MS = 1_800_000;
const DAY_MS = 86_400_000;

export interface StockAgingDeps {
  now: () => Date;
  source: () => Promise<StockAgingSource>;
  scope: () => Promise<StockAgingScope>;
  emanetOn: () => Promise<boolean>;
  /** Bekçi körlük zemini: yalnız bu depolar (üretimde tanımsız = tüm depolar). */
  warehouseIds?: readonly string[];
  /** Bekçi: `warehouseIds` kipinde depo atanmamış grubu da oku. */
  includeUnassigned?: boolean;
}

const REAL_DEPS: Readonly<StockAgingDeps> = {
  now: () => new Date(),
  source: () => readStockAgingSource(),
  scope: () => readStockAgingScope(),
  emanetOn: () => readEmanetEnabled(),
};
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

/** Kapsamın metindeki tek kelimesi. */
export function scopeLabel(scope: StockAgingScope): string {
  return scope === "raf" ? "raf" : "tümü";
}

/** Depo atanmamış toplar grubunun konu anahtarı (UUID olmayan sabit; `subjectId` boş kalır). */
export const UNASSIGNED_WAREHOUSE_KEY = "depo-atanmamis";

export function toSubject(g: AgedStockGroup, source: StockAgingSource, days: number, scope: StockAgingScope): ConditionSubject {
  const key = g.warehouseId ?? UNASSIGNED_WAREHOUSE_KEY;
  return {
    key, type: "depo", id: g.warehouseId,
    payload: {
      depoId: key, depoAd: g.warehouseName, adet: g.rollCount, gun: days,
      metre: Math.round(g.meters * 10) / 10, kapsam: scopeLabel(scope), yasKaynagi: ageSourceLabel(source, g.fallbackCount),
    },
  };
}

export async function agedStockSubjects(): Promise<ConditionSubject[]> {
  const days = Number(effectiveNotificationParams(STOCK_AGING_KIND).gun);
  const source = await deps.source();
  const scope = await deps.scope();
  const emanetOn = await deps.emanetOn();
  const cutoff = new Date(deps.now().getTime() - days * DAY_MS);
  const groups = await loadAgedStockGroups(prisma, { source, scope, emanetOn, cutoff, warehouseIds: deps.warehouseIds, includeUnassigned: deps.includeUnassigned });
  return groups.map((g) => toSubject(g, source, days, scope));
}

export function registerStockAgingConditionSource(): void {
  registerConditionSource({ kind: STOCK_AGING_KIND, periodMs: PERIOD_MS, evaluate: () => agedStockSubjects() });
}
