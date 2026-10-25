// Açık hata notu (KQ-D8, K7): tambursuz rotada karar verilmemiş hatalar kaybolmasın diye
// etikete ve (opt-in) sevk belgesine BİLGİ olarak taşınır. Etiket ve irsaliye AYNI dizgiyi
// basar (tek kaynak); sevk rakamını etkilemez.
import prisma from "../../lib/prisma";
import { fmtTrNum } from "../document-render/fmt-num";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "./roll-error-scope.helper";

export const OPEN_DEFECT_NOTE_MAX = 4;

export interface OpenDefectLike {
  startMeter: number | null;
  name: string | null;
}

/** "12,5 m Leke · 40 m Delik" — metreye göre, ilk 4 + "+N"; hatasız "". */
export function formatOpenDefectNote(defects: readonly OpenDefectLike[]): string {
  const sorted = [...defects].sort(
    (a, b) => (a.startMeter ?? Number.POSITIVE_INFINITY) - (b.startMeter ?? Number.POSITIVE_INFINITY),
  );
  const parts = sorted.slice(0, OPEN_DEFECT_NOTE_MAX).map((d) => {
    const name = (d.name ?? "").trim() || "Hata";
    if (d.startMeter == null) return name;
    const m = fmtTrNum(d.startMeter, Number.isInteger(Math.round(d.startMeter * 10) / 10) ? 0 : 1);
    return `${m} m ${name}`;
  });
  const rest = sorted.length - parts.length;
  return parts.join(" · ") + (rest > 0 ? ` +${rest}` : "");
}

/** Topların AÇIK (Tambur kararı verilmemiş, işlem kökenli) hata notları; hatasız top haritada yok. */
export async function loadOpenDefectNotes(rollIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rollIds.length === 0) return out;
  const rows = await prisma.rollError.findMany({
    where: { rollId: { in: [...rollIds] }, isProcessed: false, ...ACTIONABLE_ROLL_ERROR_WHERE },
    select: { rollId: true, startMeter: true, errorType: true, defectType: { select: { name: true } } },
  });
  const byRoll = new Map<string, OpenDefectLike[]>();
  for (const r of rows) {
    const list = byRoll.get(r.rollId) ?? [];
    list.push({ startMeter: r.startMeter != null ? Number(r.startMeter) : null, name: r.errorType ?? r.defectType?.name ?? null });
    byRoll.set(r.rollId, list);
  }
  for (const [id, list] of byRoll) out.set(id, formatOpenDefectNote(list));
  return out;
}
