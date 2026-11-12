// =============================================================================
// EL TERMİNALİ OKUTMA SINIFLANDIRICISI — SAF (IO yok), tek karar tablosu
// =============================================================================
// Sevk Çıkışı'nda okutulan top için "ne olacak" sorusunun TEK cevabı: ekle · aktar · çıkar (onaylı) ·
// hazır değil (onay sor) · reddet. İstemci yalnız onay sorar; karar sunucuda (`shipping/handheld-load.ts`
// tx içinde, top ve birimler kilitliyken çağırır). Plan: PLAN-elt-sevk-v2 §3–§4, kararlar K1/K2/K5.
// =============================================================================
import { LoadUnitKind, Prisma, RollStatus } from "@prisma/client";

import { ROLL_STATUS_TR } from "../../constants/status-labels";
import { NON_SACKABLE_STATUSES } from "./sack-invariants.helper";
import { readinessClassOf } from "./ship-readiness.helper";

export type HandheldRejectReason =
  | "NOT_FOUND"
  | "AMBIGUOUS_CODE"
  | "SACK_CODE"
  | "ROLL_IN_OTHER_SHIPMENT"
  | "ROLL_SHIPPED"
  | "ROLL_IN_POOL_SACK"
  | "OWNER_MISMATCH"
  | "WAREHOUSE_MISMATCH"
  | "ROLL_NOT_PHYSICAL";

/** Yük yeri: çuval id'si ya da `null` = sevkiyatın dökme (çuvalsız) birimi. */
export type HandheldPlace = string | null;

export interface HandheldScanInput {
  roll: {
    status: RollStatus;
    sackId: string | null;
    shipmentId: string | null;
    warehouseId: string | null;
    ownerCustomerId: string | null;
    workOrderCustomerId: string | null;
  };
  /** Topun bulunduğu birimin türü (sackId doluysa); bu sevkiyatın dökme birimi mi ayrımı için. */
  rollUnitKind: LoadUnitKind | null;
  shipment: { id: string; customerId: string; warehouseId: string | null };
  target: HandheldPlace;
  flags: { confirmRemove: boolean; confirmNotReady: boolean; isRetry: boolean };
}

export type HandheldDecision =
  | { kind: "rejected"; reason: HandheldRejectReason }
  | { kind: "needsRemoveConfirm"; from: HandheldPlace }
  | { kind: "removed"; from: HandheldPlace; replayed: boolean }
  | { kind: "transferred"; from: HandheldPlace; to: HandheldPlace }
  | { kind: "needsNotReadyConfirm"; stageLabel: string }
  | { kind: "added"; to: HandheldPlace; replayed: boolean };

/**
 * Topun sevk açısından SAHİBİ (K2): emanet sahibi → yoksa iş emrinin carisi → ikisi de yoksa serbest (fabrika malı).
 * SQL ikizi `effectiveRollCustomerSql` (boğaz-ikiz; `test_elt_sevk_v2` T7 ikisini aynı toplarda karşılaştırır).
 */
export function effectiveRollCustomer(r: { ownerCustomerId: string | null; workOrderCustomerId: string | null }): string | null {
  return r.ownerCustomerId ?? r.workOrderCustomerId ?? null;
}

/** `effectiveRollCustomer` SQL ikizi — `alias` rolls satırı; parti → iş emri yolu (load-preview ile aynı bağ). */
export function effectiveRollCustomerSql(alias: string): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`COALESCE(${a}."ownerCustomerId", (SELECT wo."customerId" FROM batches b JOIN work_orders wo ON wo.id = b."workOrderId" WHERE b.id = ${a}."batchId"))`;
}

/** Hazır-olmayan (onaylanabilir) topun aşama adı — bugün yalnız ham (STOCK) bu sınıfa düşer. */
export function notReadyStageLabel(status: RollStatus): string {
  return status === RollStatus.STOCK ? "Ham (işlenmemiş)" : ROLL_STATUS_TR[status];
}

/** Fiziksel olarak sevke sokulamayan topun nedeni (K1: tamburdaki top onayla bile eklenmez). */
export function notPhysicalText(status: RollStatus): string {
  switch (status) {
    case RollStatus.IN_PRODUCTION:
      return "Bu top henüz işlemde (tambur / üretim) — önce işlemi bitirin";
    case RollStatus.AT_SUBCONTRACTOR:
      return "Bu top fasonda — binada değil";
    case RollStatus.AT_KARTELA:
      return "Bu top kartelada — binada değil";
    default:
      return `Bu top sevk edilemez (durum: ${ROLL_STATUS_TR[status]})`;
  }
}

function placeOf(input: HandheldScanInput): HandheldPlace {
  return input.rollUnitKind === LoadUnitKind.BULK ? null : input.roll.sackId;
}

/** Bu sevkiyattaki topun kararı: aynı yer → çıkar (onaylı) · başka yer → aktar (onaysız). */
function decideInShipment(input: HandheldScanInput): HandheldDecision {
  const from = placeOf(input);
  const { confirmRemove, isRetry } = input.flags;
  if (confirmRemove) return { kind: "removed", from, replayed: false };
  if (from === input.target) return isRetry ? { kind: "added", to: from, replayed: true } : { kind: "needsRemoveConfirm", from };
  return { kind: "transferred", from, to: input.target };
}

/** Serbest topun kararı: fiziksel/sahiplik/depo kapıları → hazır değilse onay → ekle. */
function decideFree(input: HandheldScanInput): HandheldDecision {
  const { roll, shipment, flags } = input;
  // Onaylı çıkarmanın belirsiz-hata tekrarı: top zaten rafta → yazım yok, başarı.
  if (flags.confirmRemove && flags.isRetry) return { kind: "removed", from: input.target, replayed: true };
  const cls = readinessClassOf(roll.status);
  if (cls === "GONE") return { kind: "rejected", reason: "ROLL_SHIPPED" };
  if (cls === null || cls === "SCRAP" || NON_SACKABLE_STATUSES.includes(roll.status)) return { kind: "rejected", reason: "ROLL_NOT_PHYSICAL" };
  const owner = effectiveRollCustomer(roll);
  if (owner !== null && owner !== shipment.customerId) return { kind: "rejected", reason: "OWNER_MISMATCH" };
  if (shipment.warehouseId && roll.warehouseId && roll.warehouseId !== shipment.warehouseId) return { kind: "rejected", reason: "WAREHOUSE_MISMATCH" };
  if (cls === "IN_PROCESS" && !flags.confirmNotReady) return { kind: "needsNotReadyConfirm", stageLabel: notReadyStageLabel(roll.status) };
  return { kind: "added", to: input.target, replayed: false };
}

/**
 * Karar tablosu (PLAN §4 md. 5). Sıra load-bearing: sevk edilmiş → başka sevkiyat → havuz çuvalı (K5) →
 * bu sevkiyat (aktar/çıkar) → serbest top kapıları. Yazım YAPMAZ; çağıran kararı atomik claim'le uygular.
 */
export function classifyHandheldScan(input: HandheldScanInput): HandheldDecision {
  const { roll, shipment } = input;
  if (roll.status === RollStatus.SHIPPED) return { kind: "rejected", reason: "ROLL_SHIPPED" };
  if (roll.shipmentId !== null && roll.shipmentId !== shipment.id) return { kind: "rejected", reason: "ROLL_IN_OTHER_SHIPMENT" };
  if (roll.sackId !== null && roll.shipmentId === null) return { kind: "rejected", reason: "ROLL_IN_POOL_SACK" };
  if (roll.shipmentId === shipment.id) return decideInShipment(input);
  return decideFree(input);
}
