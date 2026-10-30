// Sevke Hazır İşler — saf görünüm kuralları (sekme kümesi, durum süzgeci, Hızlı Sevk satırı). Bileşenden ayrı ki
// tersine çevrilmeleri bir testi kırsın.
import { TERIM } from "@/lib/terim";
import type { QuickShipRoll } from "@/pages/Operations/Rolls/quickShipService";
import type { ReadyWorkRoll, ReadyWorkState, ReadyWorkUnit } from "./service";

export interface ReadyWorksTab {
  unit: ReadyWorkUnit;
  label: string;
}

const ALL_TABS: ReadyWorksTab[] = [
  { unit: "workOrder", label: TERIM.terbiyeIsEmri.tekil },
  { unit: "deliveryNote", label: "Gelen belge" },
  { unit: "customerBatch", label: "Parti" },
  { unit: "customer", label: "Müşteri" },
];

/** Gelen belge verisine dayanan birimler — modül kapalıyken sekme YOK ve istek ATILMAZ (uç 403 MODULE_DISABLED verir). */
export const INCOMING_DOC_UNITS: readonly ReadyWorkUnit[] = ["deliveryNote", "customerBatch"];

export function readyWorksTabs(incomingDocEnabled: boolean): ReadyWorksTab[] {
  return incomingDocEnabled ? ALL_TABS : ALL_TABS.filter((t) => !INCOMING_DOC_UNITS.includes(t.unit));
}

export type ReadyStateFilter = "READY" | "PARTIAL" | "ALL";

export const STATE_FILTERS: Array<{ key: ReadyStateFilter; label: string }> = [
  { key: "READY", label: "Hazır" },
  { key: "PARTIAL", label: "Kısmi" },
  { key: "ALL", label: "Tümü" },
];

/** Süzgeç → sunucu `state` listesi (boş = tümü). Süzme sunucuda; istemci satır elemez. */
export function statesForFilter(f: ReadyStateFilter): ReadyWorkState[] {
  return f === "ALL" ? [] : [f];
}

export const STATE_LABEL: Record<ReadyWorkState, string> = { READY: "Hazır", PARTIAL: "Kısmi", NONE: "Hazır değil" };

/** İlerleme: hedef varsa hazır/hedef; yoksa hazır/(hazır+işlemde). 0–100, yuvarlanmış. */
export function readinessPercent(r: { readyMeters: number; inProcessMeters: number; targetMeters: number | null }): number {
  const base = r.targetMeters && r.targetMeters > 0 ? r.targetMeters : r.readyMeters + r.inProcessMeters;
  if (base <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((r.readyMeters / base) * 100)));
}

/** Toplar ucu satırı → Hızlı Sevk satırı (boğaz `POST /api/shipping/shipments/from-rolls`). */
export function toQuickShipRoll(r: ReadyWorkRoll): QuickShipRoll {
  return {
    id: r.id,
    barcode: r.barcode,
    qty: Number(r.currentQty),
    width: null,
    itemName: r.itemName ?? "—",
    colorName: r.colorName,
    warehouseId: r.warehouseId ?? null,
  };
}

/**
 * Hızlı Sevk boğazının (`SHIPPABLE_ROLL_WHERE` + tek depo) aynası: HAZIR sınıfı çuvaldaki / sevkiyattaki topu da
 * kapsar ama Hızlı Sevk onları 400 ile reddeder — ön-seçime girerse kullanıcı çıkmaza düşer.
 */
export function isQuickShippable(r: ReadyWorkRoll): boolean {
  return r.readinessClass === "READY" && r.inSack !== true && r.inShipment !== true;
}

export const warehouseKey = (r: ReadyWorkRoll): string => r.warehouseId ?? "—";

/** Varsayılan seçimin deposu: en çok sevk edilebilir topun durduğu depo (tek sevkiyat tek depodan çıkar). */
export function primaryWarehouseKey(rolls: ReadyWorkRoll[]): string | null {
  const count = new Map<string, number>();
  for (const r of rolls) if (isQuickShippable(r)) count.set(warehouseKey(r), (count.get(warehouseKey(r)) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of count) if (best === null || n > (count.get(best) ?? 0)) best = k;
  return best;
}

export function rollBlockLabel(r: ReadyWorkRoll): string | null {
  if (r.readinessClass !== "READY") return null;
  if (r.inShipment) return "Sevkiyatta";
  if (r.inSack) return "Çuvalda";
  return null;
}
