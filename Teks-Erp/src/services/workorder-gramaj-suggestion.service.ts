// =============================================================================
// İŞ EMRİ HEDEF GRAMAJ ÖNERİSİ — gelen belgeden (H9b, DALGA2 §3 md. 2 · OCR F1.2)
// =============================================================================
// Zincir: İE'nin canlı topları (`whereRollsOfWorkOrder`) → en yakın atanın gelen belge satırı
// (`resolveDeliveryNoteLinesForRolls`) → satırın işlem metni → H9 çözücüsü (`suggestProcess`: önce PROCESS
// sözlüğü, sonra kalıp). Salt okunur: hiçbir tabloya yazmaz; "Uygula" mevcut hedef ucunu (PUT target-values) çağırır.
// İlke: yanlış öneri verilmez — kapsanan toplar TEK değerde birleşmezse öneri YOK, liste döner.
// =============================================================================
import prisma from "../lib/prisma";
import { K18_DEAD_STATUSES } from "./batch.service";
import { suggestProcess, type ProcessSuggestion } from "./gelen-belge-eslestirme.service";
import { loadKursunGramajOptions } from "./helpers/kursun-bypass-gramaj.helper";
import { resolveDeliveryNoteLinesForRolls } from "./helpers/roll-delivery-note-line.helper";
import { whereRollsOfWorkOrder } from "./helpers/workorder-rolls.helper";

export interface GramajSuggestionEntry {
  /** Çözülen gramaj çeşidi; işlem metninden emin olunamadıysa null. */
  readonly valueId: string | null;
  readonly valueName: string | null;
  /** Bu gruptaki ilk satırın geçerli işlem metni (gösterim; çözülmeyen grup metin başınadır). */
  readonly processText: string | null;
  readonly rollCount: number;
}

export interface WorkOrderGramajSuggestion {
  /** Kapsanan bütün toplar aynı çeşide çözüldüyse o çeşit; aksi halde null (liste gösterilir). */
  readonly suggested: { readonly valueId: string; readonly valueName: string } | null;
  /** İE'nin canlı top sayısı (K18 ölü kümesi hariç). */
  readonly rollCount: number;
  /** Gelen belge satırı (kendisinde ya da atasında) olan top sayısı. */
  readonly coveredRollCount: number;
  readonly entries: ReadonlyArray<GramajSuggestionEntry>;
}

/** Saf birleştirme: top başına çözüm → öneri. Kapsanan her top AYNI (boş olmayan) çeşide çözülmeliyse öneri. */
export function mergeGramajSuggestions(
  rollCount: number,
  perRoll: ReadonlyArray<{ processText: string | null; suggestion: ProcessSuggestion }>,
): WorkOrderGramajSuggestion | null {
  if (perRoll.length === 0) return null;
  const groups = new Map<string, { valueId: string | null; valueName: string | null; processText: string | null; rollCount: number }>();
  for (const r of perRoll) {
    const v = r.suggestion.suggested;
    const key = v ? `v:${v.id}` : `t:${r.processText ?? ""}`;
    const g = groups.get(key);
    if (g) g.rollCount++;
    else groups.set(key, { valueId: v?.id ?? null, valueName: v?.name ?? null, processText: r.processText, rollCount: 1 });
  }
  const entries = [...groups.values()].sort((a, b) => b.rollCount - a.rollCount);
  const only = entries.length === 1 ? entries[0]! : null;
  const suggested = only?.valueId ? { valueId: only.valueId, valueName: only.valueName ?? "" } : null;
  return { suggested, rollCount, coveredRollCount: perRoll.length, entries };
}

/** İE için öneri; hiçbir topta gelen belge satırı yoksa null. Toplu okuma: toplar tek sorgu, satırlar ata seviyesi başına tek sorgu. */
export async function suggestWorkOrderGramaj(workOrderId: string): Promise<WorkOrderGramajSuggestion | null> {
  const rolls = await prisma.roll.findMany({
    where: { AND: [whereRollsOfWorkOrder(workOrderId), { status: { notIn: K18_DEAD_STATUSES } }] },
    select: { id: true },
  });
  if (rolls.length === 0) return null;
  const lines = await resolveDeliveryNoteLinesForRolls(rolls.map((r) => r.id));
  if (lines.size === 0) return null;
  const options = await loadKursunGramajOptions();
  // Aynı (gönderen, metin) çifti bir kez çözülür: sözlük sorgusu top başına değil, ayrık metin başına.
  const cache = new Map<string, ProcessSuggestion>();
  const perRoll: Array<{ processText: string | null; suggestion: ProcessSuggestion }> = [];
  for (const line of lines.values()) {
    const key = `${line.senderCustomerId ?? ""}\u0000${line.processText ?? ""}`;
    if (!cache.has(key)) cache.set(key, await suggestProcess(line.processText, line.senderCustomerId, options));
    perRoll.push({ processText: line.processText, suggestion: cache.get(key)! });
  }
  return mergeGramajSuggestions(rolls.length, perRoll);
}
