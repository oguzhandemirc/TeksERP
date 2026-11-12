// İş emri aramasının belge dalı (Gülkesim K17; fabrika cevabı 23-ek): fiş/evrak no, GB no ve parti no'larıyla
// iş emri bulma. İstasyon elle araması, kurşun/tambur açık kart listesi ve panel İE listesi TEK yüklemden beslenir.
import { DeliveryNoteStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { buildTextSearch } from "../../utils/query-parser";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";

/** Topu doğmuş (onaylı) belgeler — taslakta top yok, iptal edilen belge mükerrerden de eşlemeden de çıkar (K15). */
export const LOOKUP_NOTE_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];

/** Belgenin parti no'su olmayan kod alanları — eşleşen belgenin TÜM topları (parti alanları `workOrdersOfNoteBatchWhere`). */
const NOTE_DOC_CODE_FIELDS = ["senderDocNo", "noteNo", "customerOrderNo"] as const;

/** "Bu belge alanlarından birini taşıyan canlı belgenin topu bu iş emrinde" — liste aramasının belge dalı. */
export function workOrderDocSearchWhere(q: string): Prisma.WorkOrderWhereInput | null {
  const leaves = buildTextSearch<Prisma.CustomerDeliveryNoteWhereInput>(q, { code: NOTE_DOC_CODE_FIELDS });
  const batch = buildTextSearch<{ customerBatchNo: Prisma.StringNullableFilter }>(q, { code: ["customerBatchNo"] })[0]?.customerBatchNo;
  const ors: Prisma.WorkOrderWhereInput[] = [];
  if (leaves.length > 0) ors.push(whereWorkOrdersOfRolls({ deliveryNoteLine: { note: { status: { in: [...LOOKUP_NOTE_STATUSES] }, OR: leaves } } }));
  if (batch) ors.push(workOrdersOfNoteBatchWhere(batch));
  return ors.length === 0 ? null : ors.length === 1 ? ors[0]! : { OR: ors };
}

// ── Belgenin parti no'su → iş emri (2026-11-10, çok partili belge) ──────────────────────────────────────────────
// Çok partide parti no SATIRDA yaşar, başlık tek değer taşır; başlık değeri yalnız satırında parti no olmayan belgede
// bütün belgeye genellenir (satır partisini ezmez). Where ↔ bellek-içi ikiz: `LINE_HAS_BATCH_WHERE` ↔ `lineHasBatch`.

/** Satır parti no taşıyor (boş metin taşımaz sayılır). */
export const LINE_HAS_BATCH_WHERE: Prisma.CustomerDeliveryNoteLineWhereInput = { AND: [{ customerBatchNo: { not: null } }, { customerBatchNo: { not: "" } }] };
export const lineHasBatch = (v: string | null | undefined): v is string => v !== null && v !== undefined && v !== "";

/** "Parti no'su bu filtreye uyan canlı belge satırının topu bu iş emrinde" — okutma, elle arama ve liste aramasının TEK yüklemi. */
export function workOrdersOfNoteBatchWhere(batchNo: Prisma.StringNullableFilter): Prisma.WorkOrderWhereInput {
  const live = { status: { in: [...LOOKUP_NOTE_STATUSES] } };
  return {
    OR: [
      whereWorkOrdersOfRolls({ deliveryNoteLine: { customerBatchNo: batchNo, note: live } }),
      whereWorkOrdersOfRolls({ deliveryNoteLine: { note: { ...live, lines: { none: LINE_HAS_BATCH_WHERE }, OR: [{ ourBatchNo: batchNo }, { customerBatchNo: batchNo }] } } }),
    ],
  };
}

/** Bellek-içi ikiz: bir belgenin bu İE'ye düşen parti no'ları — satırda parti varsa İE'nin satırlarınınki, yoksa başlığınki. */
export function noteBatchNosForWorkOrder(
  header: { customerBatchNo: string | null; ourBatchNo?: string | null },
  noteHasLineBatch: boolean,
  ownLineBatches: ReadonlyArray<string | null>,
): string[] {
  const values = noteHasLineBatch ? ownLineBatches : [header.customerBatchNo, header.ourBatchNo];
  return [...new Set(values.filter(lineHasBatch))];
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
