// İş emri aramasının belge dalı (Gülkesim K17; fabrika cevabı 23-ek): fiş/evrak no, GB no ve parti no'larıyla
// iş emri bulma. İstasyon elle araması, kurşun/tambur açık kart listesi ve panel İE listesi TEK yüklemden beslenir.
import { DeliveryNoteStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { buildTextSearch } from "../../utils/query-parser";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";

/** Topu doğmuş (onaylı) belgeler — taslakta top yok, iptal edilen belge mükerrerden de eşlemeden de çıkar (K15). */
export const LOOKUP_NOTE_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];
/** Belgede aranan KOD alanları: fiş/evrak no (gönderen belge no) · GB no · müşteri parti no · bizim parti no · sipariş no. */
export const NOTE_SEARCH_CODE_FIELDS = ["senderDocNo", "noteNo", "customerBatchNo", "ourBatchNo", "customerOrderNo"] as const;

/** "Bu belge alanlarından birini taşıyan canlı belgenin topu bu iş emrinde" — liste aramasının belge dalı. */
export function workOrderDocSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const leaves = buildTextSearch<Prisma.CustomerDeliveryNoteWhereInput>(q, { code: NOTE_SEARCH_CODE_FIELDS });
  if (leaves.length === 0) return null;
  return whereWorkOrdersOfRolls({ deliveryNoteLine: { note: { status: { in: [...LOOKUP_NOTE_STATUSES] }, OR: leaves } } });
}

/** İstasyon iş listesi araması: İE no · parti no · belge alanları (kurşun + tambur açık kartları, elle arama). */
export function stationWorkSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const own = buildTextSearch<Prisma.WorkOrderWhereInput>(q, { code: ["workOrderNumber", "batches.some.batchNumber"] });
  const doc = workOrderDocSearchWhere(q);
  const ors = doc ? [...own, doc] : own;
  ors.push(...workOrderParameterSearch(q));
  return ors.length > 0 ? { OR: ors } : null;
}

/** Künyede aranan kağıt kimlikleri: gönderenin İE no'su (K4) ve çok partide partinin kağıttaki no'su (SERIES'te de kaybolmaz). */
export const WORK_ORDER_PARAMETER_SEARCH_KEYS = ["senderWorkOrderNo", "customerBatchNo"] as const;

/** "26K-24749" gibi künye kimlikleri — istasyon ve panel İE araması aynı yaprakları kullanır. */
export function workOrderParameterSearch(q: string): Prisma.WorkOrderWhereInput[] {
  const raw = q.trim();
  if (raw.length < 3) return [];
  const terms = [...new Set([raw, raw.toUpperCase()])];
  return WORK_ORDER_PARAMETER_SEARCH_KEYS.flatMap((key) => terms.map((t) => ({ parameters: { path: [key], string_contains: t } })));
}

/** İstasyon açık kart listesi `?q=` — boş/eksik = bugünkü liste (süzme yok). */
export const stationSearchQuerySchema = z.object({
  q: z.string({ message: "Arama metni tek değer olmalı" }).trim().max(64, "En çok 64 karakter").optional(),
});
