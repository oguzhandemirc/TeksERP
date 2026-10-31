// =============================================================================
// DIŞ ADIM NOTUNA HEDEF DEĞER TALİMATI (SY-F4, tasarım §7.5 madde 4)
// =============================================================================
// Sipariş satırından kopyalanan hedef değer ("Kuşak: Zebra"), o özelliği uygulayan FASON (EXTERNAL) adımın
// notuna iş emri DOĞUŞUNDA eklenir; fason çekisi talimatı `dispatch.instruction ?? step.notes`tir
// (fason.md, ayrı alan açılmaz). Yalnız doğuşta yazılır → sevkte donmuş çeki hiç değişmez.
// İdempotent: notta aynı satır (boşluk/harf büyüklüğü farkı yok sayılarak) zaten varsa tekrar eklenmez.
// Gövdeden gelen açık hedef (panelin kurşun gramajı) nota YAZILMAZ — bugünkü fabrikalarda bayt-aynı.
// =============================================================================
import type { Prisma, PrismaClient } from "@prisma/client";
import type { CopiedLineTarget } from "./order-line-target-copy.helper";

type Reader = Prisma.TransactionClient | PrismaClient;

/** Adım notunun panel/Zod sınırı (workorder.controller `notes: max(500)`); aşılırsa not değişmez, uyarı döner. */
export const STEP_NOTE_MAX = 500;
export const TARGET_NOTE_TOO_LONG = "TARGET_NOTE_TOO_LONG";
/** Notta aynı etiketli ama farklı değerli satır var (elle yazılmış çelişen talimat). */
export const TARGET_NOTE_LABEL_CONFLICT = "TARGET_NOTE_LABEL_CONFLICT";
/** İE hedefi doğuştan sonra değişti; bitmemiş dış adım notunda eski talimat satırı duruyor. */
export const TARGET_NOTE_STALE = "TARGET_NOTE_STALE";

export function targetNoteLine(label: string, valueName: string): string {
  return `${label}: ${valueName}`;
}

function normalizeLine(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function sameLine(a: string, b: string): boolean {
  return normalizeLine(a).localeCompare(normalizeLine(b), "tr", { sensitivity: "accent" }) === 0;
}

/** Saf birleştirme: notta olmayan satırları alta ekler; hepsi varsa notu AYNEN döndürür (idempotent). */
export function mergeTargetNoteLines(notes: string | null, lines: readonly string[]): string | null {
  const existing = (notes ?? "").split(/\r?\n/);
  const added: string[] = [];
  for (const line of lines) {
    if (existing.some((e) => sameLine(e, line)) || added.some((a) => sameLine(a, line))) continue;
    added.push(line);
  }
  if (added.length === 0) return notes;
  const base = (notes ?? "").trimEnd();
  return base === "" ? added.join("\n") : `${base}\n${added.join("\n")}`;
}

function labelOf(line: string): string | null {
  const i = line.indexOf(":");
  return i > 0 ? normalizeLine(line.slice(0, i)) : null;
}

/** Notta aynı etiketle başlayan ama talimattan farklı satırlar (ör. elle "Kuşak: Leopar" varken "Kuşak: Zebra"). */
export function conflictingLabelLines(notes: string | null, line: string): string[] {
  const label = labelOf(line);
  if (label === null) return [];
  return (notes ?? "").split(/\r?\n/).filter((e) => {
    const l = labelOf(e);
    return l !== null && l.localeCompare(label, "tr", { sensitivity: "accent" }) === 0 && !sameLine(e, line);
  });
}

interface NoteStep {
  stationId: string;
  notes: string | null;
}

/**
 * Kopyalanan hedefleri, özelliği (ya da BAYRAK ikizini) yetenek listesinde taşıyan EXTERNAL istasyon adımlarının
 * notuna ekler. Adımlar yerinde güncellenmez; yeni dizi döner. Kopya yoksa sorgu koşmaz, dizi aynen döner.
 */
export async function appendTargetNotesToExternalSteps<T extends NoteStep>(
  db: Reader,
  steps: readonly T[],
  copied: readonly CopiedLineTarget[],
): Promise<{ steps: T[]; warnings: string[] }> {
  if (copied.length === 0 || steps.length === 0) return { steps: [...steps], warnings: [] };
  const stationIds = [...new Set(steps.map((s) => s.stationId))];
  const external = await db.station.findMany({ where: { id: { in: stationIds }, type: "EXTERNAL" }, select: { id: true, name: true } });
  if (external.length === 0) return { steps: [...steps], warnings: [] };
  const propIds = [...new Set(copied.flatMap((c) => (c.flagPropertyId ? [c.propertyId, c.flagPropertyId] : [c.propertyId])))];
  const caps = await db.stationProperty.findMany({
    where: { stationId: { in: external.map((e) => e.id) }, propertyId: { in: propIds } },
    select: { stationId: true, propertyId: true },
  });
  const capSet = new Set(caps.map((c) => `${c.stationId}|${c.propertyId}`));
  const nameById = new Map(external.map((e) => [e.id, e.name]));
  const warnings: string[] = [];
  const out = steps.map((step) => {
    if (!nameById.has(step.stationId)) return step;
    const lines = copied
      .filter((c) => capSet.has(`${step.stationId}|${c.propertyId}`) || (c.flagPropertyId !== null && capSet.has(`${step.stationId}|${c.flagPropertyId}`)))
      .map((c) => targetNoteLine(c.label, c.valueName));
    if (lines.length === 0) return step;
    const clashes = lines.flatMap((l) => conflictingLabelLines(step.notes, l).map((c) => `'${normalizeLine(c)}' ↔ '${l}'`));
    if (clashes.length > 0) {
      warnings.push(`[${TARGET_NOTE_LABEL_CONFLICT}] ${nameById.get(step.stationId)}: adım notunda farklı talimat var (${clashes.join(", ")}) — fason çekisinden önce notu düzeltin.`);
    }
    const merged = mergeTargetNoteLines(step.notes, lines);
    if (merged === step.notes) return step;
    if ((merged ?? "").length > STEP_NOTE_MAX) {
      warnings.push(`[${TARGET_NOTE_TOO_LONG}] ${nameById.get(step.stationId)}: adım notu ${STEP_NOTE_MAX} karakteri aşacağı için '${lines.join(", ")}' talimatı nota eklenmedi — fason çekisine elle yazın.`);
      return step;
    }
    return { ...step, notes: merged };
  });
  return { steps: out, warnings };
}

/**
 * İE hedefi PUT ile değişince (eski değer damgalanınca) bitmemiş EXTERNAL adım notunda eski "<etiket>: <değer>"
 * satırı kalmışsa uyarı üretir. Not KENDİLİĞİNDEN yazılmaz (yalnız doğuşta yazılır kuralı); planlamacı düzeltir.
 */
export async function staleTargetNoteWarnings(
  db: Reader,
  workOrderId: string,
  revoked: ReadonlyArray<{ propertyId: string; valueId: string }>,
): Promise<string[]> {
  if (revoked.length === 0) return [];
  const steps = await db.workOrderStep.findMany({
    where: { workOrderId, status: { in: ["PENDING", "ACTIVE"] }, notes: { not: null }, station: { type: "EXTERNAL" } },
    select: { notes: true, station: { select: { name: true } } },
  });
  if (steps.length === 0) return [];
  const values = await db.fabricPropertyValue.findMany({
    where: { id: { in: revoked.map((r) => r.valueId) } },
    select: { name: true, property: { select: { name: true, variantOf: { select: { name: true } } } } },
  });
  const oldLines = values.map((v) => targetNoteLine(v.property.variantOf?.name ?? v.property.name, v.name));
  const warnings: string[] = [];
  for (const step of steps) {
    const stale = oldLines.filter((l) => (step.notes ?? "").split(/\r?\n/).some((e) => sameLine(e, l)));
    if (stale.length > 0) {
      warnings.push(`[${TARGET_NOTE_STALE}] ${step.station.name}: adım notunda eski talimat var (${stale.join(", ")}) — fason çekisinden önce notu düzeltin.`);
    }
  }
  return warnings;
}
