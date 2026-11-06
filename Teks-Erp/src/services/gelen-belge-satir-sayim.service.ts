// Gelen belge listesi "top" sayısı: belgenin KENDİ satırları — onayda doğan parti kaydı (özet satırı, `isSummaryLine`)
// sayılmaz. `_count.lines` özet satırlarını da saydığı için 12 toplu belge "15 satır" görünüyordu (2026-11-06 ekran denetimi).
import prisma from "../lib/prisma";
import { partyLineId, summaryLineId } from "./gelen-belge-kontrol.service";

/** Not başına belge satırı sayısı (özet satırı hariç). İki sorgu: (not, blok) çiftleri → aday özet kimlikleri → var olanlar. */
export async function docLineCounts(notes: ReadonlyArray<{ id: string; _count: { lines: number } }>): Promise<Map<string, number>> {
  const out = new Map(notes.map((n) => [n.id, n._count.lines]));
  const ids = notes.filter((n) => n._count.lines > 0).map((n) => n.id);
  if (ids.length === 0) return out;
  const blocks = await prisma.customerDeliveryNoteLine.groupBy({ by: ["noteId", "blockNo"], where: { noteId: { in: ids } } });
  const candidates = [...new Set([...ids.map(summaryLineId), ...blocks.map((b) => partyLineId(b.noteId, b.blockNo))])];
  const summaries = await prisma.customerDeliveryNoteLine.groupBy({ by: ["noteId"], where: { noteId: { in: ids }, id: { in: candidates } }, _count: { _all: true } });
  for (const s of summaries) out.set(s.noteId, (out.get(s.noteId) ?? 0) - s._count._all);
  return out;
}

/** Liste kalemlerine `docLineCount` ekler (eski istemci `_count.lines` okur, alanı yok sayar). */
export async function withDocLineCount<T extends { id: string; _count: { lines: number } }>(items: T[]): Promise<Array<T & { docLineCount: number }>> {
  const counts = await docLineCounts(items);
  return items.map((n) => ({ ...n, docLineCount: counts.get(n.id) ?? n._count.lines }));
}
