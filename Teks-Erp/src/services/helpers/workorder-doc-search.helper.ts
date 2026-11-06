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
  // K4 (2026-11-06): gönderenin İE no'su ("26K-24749") belgeden İE açılırken künyeye yazılır; istasyonda onunla da bulunur.
  const sender = q.trim().toUpperCase();
  if (sender.length >= 3) ors.push({ parameters: { path: ["senderWorkOrderNo"], string_contains: sender } });
  return ors.length > 0 ? { OR: ors } : null;
}

/** İstasyon açık kart listesi `?q=` — boş/eksik = bugünkü liste (süzme yok). */
export const stationSearchQuerySchema = z.object({
  q: z.string({ message: "Arama metni tek değer olmalı" }).trim().max(64, "En çok 64 karakter").optional(),
});
