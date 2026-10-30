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
    warehouseId: null,
  };
}
