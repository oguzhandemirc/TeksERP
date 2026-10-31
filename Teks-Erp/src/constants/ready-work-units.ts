// Sevke hazır iş birimleri — YAPRAK modül (yalnız tip importu). system-setting.service bunu okur;
// ready-works.service'i doğrudan import etmek modül döngüsü kurup TDZ hatası veriyordu (D4-KUC3a).
import type { ShipReadyNotifyUnit } from "../services/system-setting.service";

export type ReadyWorkUnit = "workOrder" | "deliveryNote" | "customerBatch" | "customer";
export const READY_WORK_UNITS: readonly ReadyWorkUnit[] = ["workOrder", "deliveryNote", "customerBatch", "customer"];
/** Gelen belge modülünün verisine dayanan birimler — modül kapalıyken 403 MODULE_DISABLED. */
export const INCOMING_DOC_UNITS: readonly ReadyWorkUnit[] = ["deliveryNote", "customerBatch"];
/** Sevke hazır bildirim birimi (ayar kodu) → hazır iş birimi. Bildirim kaynağı (`is.ts`) ve gelen belge modülü
 *  açılışındaki taban sıfırlaması (D4-KUC3a) aynı eşlemeyi okur. */
export const NOTIFY_UNIT_READY_UNIT: Record<ShipReadyNotifyUnit, ReadyWorkUnit> = { IE: "workOrder", GB: "deliveryNote", PARTI: "customerBatch" };
export const notifyUnitNeedsIncomingDoc = (u: ShipReadyNotifyUnit): boolean => INCOMING_DOC_UNITS.includes(NOTIFY_UNIT_READY_UNIT[u]);
