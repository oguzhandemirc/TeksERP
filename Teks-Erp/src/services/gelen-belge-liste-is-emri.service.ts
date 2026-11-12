// Gelen belge listesi "İş emri" sütunu: belgenin satırlarındaki toplar (`CustomerDeliveryNoteLine.rollId`) → iş emri.
// Bağ, belge→İE sorusunun öteki yüzeyleriyle (aynı belge kısayolu, istasyon okutması) AYNI: doğrudan satır topları +
// `whereRollsOfWorkOrder`un üç bağı (SQL ikizi `rollWorkOrderEdgesSql`). İptal İE gösterilmez. Sayfa başına TEK sorgu.
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { rollWorkOrderEdgesSql } from "./helpers/workorder-rolls.helper";

export interface NoteWorkOrderRef {
  id: string;
  workOrderNumber: string;
}

/** Belge başına bağlı iş emirleri (iptal hariç), İE no sırasıyla, tekil. Bağsız belge haritada yok. */
export async function loadNoteWorkOrders(noteIds: readonly string[]): Promise<Map<string, NoteWorkOrderRef[]>> {
  const out = new Map<string, NoteWorkOrderRef[]>();
  const ids = [...new Set(noteIds)];
  if (ids.length === 0) return out;
  const rollCond = Prisma.sql`r.id IN (SELECT l2."rollId" FROM customer_delivery_note_lines l2 WHERE l2."noteId" = ANY(${ids}::uuid[]) AND l2."rollId" IS NOT NULL)`;
  const rows = await prisma.$queryRaw<Array<{ note_id: string; id: string; work_order_number: string }>>(Prisma.sql`
    SELECT DISTINCT l."noteId" AS note_id, w.id, w."workOrderNumber" AS work_order_number
      FROM customer_delivery_note_lines l
      JOIN (${rollWorkOrderEdgesSql(rollCond)}) e ON e.roll_id = l."rollId"
      JOIN work_orders w ON w.id = e.wo_id
     WHERE l."noteId" = ANY(${ids}::uuid[]) AND w.status <> 'CANCELLED'
     ORDER BY note_id, work_order_number, w.id`);
  for (const r of rows) {
    const list = out.get(r.note_id) ?? [];
    list.push({ id: r.id, workOrderNumber: r.work_order_number });
    out.set(r.note_id, list);
  }
  return out;
}

/** Liste kalemlerine `workOrders` ekler (eski istemci alanı yok sayar). */
export async function withNoteWorkOrders<T extends { id: string }>(items: T[]): Promise<Array<T & { workOrders: NoteWorkOrderRef[] }>> {
  const byNote = await loadNoteWorkOrders(items.map((n) => n.id));
  return items.map((n) => ({ ...n, workOrders: byNote.get(n.id) ?? [] }));
}
