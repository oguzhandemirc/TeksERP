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
import { loadProcessChoiceGroups } from "./helpers/process-choice-catalog.helper";
import { resolveDeliveryNoteLinesForRolls, type RollDeliveryNoteLine } from "./helpers/roll-delivery-note-line.helper";
import { customerBatchKeyOf } from "./helpers/ship-readiness.helper";
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
  /** Kurşun dışı çeşit özellikleri (brode deseni vb., D4-D1), özellik başına aynı birleştirme. Böyle özellik yoksa anahtar YOK. */
  readonly variants?: ReadonlyArray<WorkOrderVariantSuggestion>;
  /** Türetilmiş MÜŞTERİ PARTİSİ (D4-D2; `customerBatchKeyOf`, ata zinciriyle). Partili belge yoksa anahtar YOK. */
  readonly customerBatches?: ReadonlyArray<WorkOrderCustomerBatch>;
}

export interface WorkOrderCustomerBatch {
  readonly key: string;
  readonly ownerCustomerId: string;
  readonly ownerName: string;
  readonly batchNo: string;
  readonly rollCount: number;
}

/** Kapsanan topların müşteri partileri (çok top → en kalabalık önce). Ad okuması tek sorgu. */
async function deriveCustomerBatches(lines: Iterable<RollDeliveryNoteLine>): Promise<WorkOrderCustomerBatch[]> {
  const byKey = new Map<string, { ownerCustomerId: string; batchNo: string; rollCount: number }>();
  for (const l of lines) {
    const key = customerBatchKeyOf(l.ownerCustomerId, l.customerBatchNo);
    if (!key) continue;
    const g = byKey.get(key);
    if (g) g.rollCount++;
    else byKey.set(key, { ownerCustomerId: l.ownerCustomerId!, batchNo: l.customerBatchNo!.trim(), rollCount: 1 });
  }
  if (byKey.size === 0) return [];
  const owners = await prisma.customer.findMany({ where: { id: { in: [...new Set([...byKey.values()].map((g) => g.ownerCustomerId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(owners.map((o) => [o.id, o.name]));
  return [...byKey.entries()]
    .map(([key, g]) => ({ key, ...g, ownerName: nameOf.get(g.ownerCustomerId) ?? "" }))
    .sort((a, b) => b.rollCount - a.rollCount || a.batchNo.localeCompare(b.batchNo));
}

export interface WorkOrderVariantSuggestion {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly suggested: { readonly valueId: string; readonly valueName: string } | null;
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
  const groups = await loadProcessChoiceGroups();
  // Aynı (gönderen, metin) çifti bir kez çözülür: sözlük sorgusu top başına değil, ayrık metin başına.
  const cache = new Map<string, ProcessSuggestion>();
  const perRoll: Array<{ processText: string | null; suggestion: ProcessSuggestion }> = [];
  for (const line of lines.values()) {
    const key = `${line.senderCustomerId ?? ""}\u0000${line.processText ?? ""}`;
    if (!cache.has(key)) cache.set(key, await suggestProcess(line.processText, line.senderCustomerId, options, groups));
    perRoll.push({ processText: line.processText, suggestion: cache.get(key)! });
  }
  const base = mergeGramajSuggestions(rolls.length, perRoll);
  if (!base) return base;
  const batches = await deriveCustomerBatches(lines.values());
  const merged = batches.length > 0 ? { ...base, customerBatches: batches } : base;
  if (groups.length === 0) return merged;
  // Özellik başına aynı ilke: kapsanan toplar o özellikte TEK değerde birleşmezse öneri yok.
  const variants = groups.map((g): WorkOrderVariantSuggestion => {
    const per = perRoll.map((r) => {
      const v = r.suggestion.variants?.find((x) => x.propertyId === g.propertyId);
      return { processText: r.processText, suggestion: { rawText: r.suggestion.rawText, suggested: v?.suggested ?? null, source: v?.source ?? "NONE" } as ProcessSuggestion };
    });
    const m = mergeGramajSuggestions(rolls.length, per)!;
    return { propertyId: g.propertyId, propertyName: g.propertyName, suggested: m.suggested, entries: m.entries };
  });
  return { ...merged, variants };
}
