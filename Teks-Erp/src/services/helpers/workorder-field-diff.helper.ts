// =============================================================================
// İş emri PLANININ deftere yazımı — önce/sonra satırından alan ve rota diff'i
// =============================================================================
// Satırı `workorder-event.helper`ın yazıcısı yazar; burası neyin değiştiğini ve
// okunur etiketini çözer. İzlenen alan kümesi `constants/workorder-event-fields.ts`.
// =============================================================================

import { Prisma, WorkOrderType } from "@prisma/client";
import { factoryDateTr } from "../../constants/time";
import {
  WORK_ORDER_FIELD_KIND,
  WORK_ORDER_TRACKED_FIELDS,
  type WorkOrderTrackedField,
} from "../../constants/workorder-event-fields";
import {
  WORK_ORDER_TYPE_LABEL,
  recordStepPlanChangesTx,
  recordWorkOrderFieldChangesTx,
  type WorkOrderEventCtx,
  type WorkOrderFieldChange,
} from "./workorder-event.helper";

type Tx = Prisma.TransactionClient;

export type WorkOrderFieldValues = Partial<Record<WorkOrderTrackedField, unknown>>;

/** Karşılaştırma ve saklama biçimi — Decimal/Date/boolean tek kanonik metne. */
function canonicalValue(field: WorkOrderTrackedField, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  switch (WORK_ORDER_FIELD_KIND[field]) {
    case "number":
      return new Prisma.Decimal(v as Prisma.Decimal.Value).toString();
    case "date":
      return (v instanceof Date ? v : new Date(String(v))).toISOString();
    case "flag":
      return v ? "true" : "false";
    default:
      return String(v);
  }
}

async function nameMap(tx: Tx, kind: "color" | "item" | "route", ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const where = { id: { in: ids } };
  const select = { id: true, name: true } as const;
  const rows =
    kind === "color"
      ? await tx.color.findMany({ where, select })
      : kind === "item"
        ? await tx.item.findMany({ where, select })
        : await tx.route.findMany({ where, select });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Satırın o anki okunur adı — kimlik alanlarında ad sonradan değişse de defterde donar. */
/** İzlenen alan farkı — `after`ta verilen (undefined olmayan) alanlardan kanonik değeri değişenler. Yazmaz. */
export function diffTrackedFields(
  before: WorkOrderFieldValues,
  after: WorkOrderFieldValues,
): (WorkOrderFieldChange & { field: WorkOrderTrackedField })[] {
  return WORK_ORDER_TRACKED_FIELDS.filter((f) => after[f] !== undefined)
    .map((field) => ({ field, from: canonicalValue(field, before[field]), to: canonicalValue(field, after[field]) }))
    .filter((c) => c.from !== c.to);
}

export async function labelChanges(tx: Tx, changes: (WorkOrderFieldChange & { field: WorkOrderTrackedField })[]): Promise<WorkOrderFieldChange[]> {
  const idsOf = (k: string) =>
    [...new Set(changes.filter((c) => WORK_ORDER_FIELD_KIND[c.field] === k).flatMap((c) => [c.from, c.to]).filter((x): x is string => !!x))];
  const names = {
    color: await nameMap(tx, "color", idsOf("color")),
    item: await nameMap(tx, "item", idsOf("item")),
    route: await nameMap(tx, "route", idsOf("route")),
  };
  const label = (field: WorkOrderTrackedField, v: string | null): string | null => {
    if (v === null) return null;
    const kind = WORK_ORDER_FIELD_KIND[field];
    if (kind === "color" || kind === "item" || kind === "route") return names[kind].get(v) ?? null;
    if (kind === "date") return factoryDateTr(new Date(v));
    if (kind === "type") return WORK_ORDER_TYPE_LABEL[v as WorkOrderType] ?? null;
    if (kind === "flag") return v === "true" ? "Aktif" : "Arşivde";
    return null;
  };
  return changes.map((c) => ({ ...c, fromLabel: label(c.field, c.from), toLabel: label(c.field, c.to) }));
}

/**
 * Plan yazımının deftere düşen yarısı: `after`ta GÖNDERİLEN (undefined olmayan)
 * izlenen alanlardan değeri gerçekten değişenler, tek grupta alan başına bir
 * satır. `before` yazımdan ÖNCE aynı tx'te okunan satırdır. Dönüş: yazılan satır.
 */
export async function recordWorkOrderFieldDiffTx(
  tx: Tx,
  workOrderId: string,
  rows: { before: WorkOrderFieldValues; after: WorkOrderFieldValues },
  ctx: WorkOrderEventCtx,
): Promise<number> {
  const changes = diffTrackedFields(rows.before, rows.after);
  if (changes.length === 0) return 0;
  await recordWorkOrderFieldChangesTx(tx, workOrderId, await labelChanges(tx, changes), ctx);
  return changes.length;
}

/** Adımın deftere giren planı — istasyon/kategori/fasoncu adları okuma anında donar. */
export interface StepSnapshot {
  id: string;
  stepSequence: number;
  stationName: string;
  notes: string | null;
  requiredCategoryId: string | null;
  categoryName: string | null;
  plannedSubcontractorId: string | null;
  subcontractorName: string | null;
  dispatchWithoutColor: boolean;
}

/** İş emrinin (ya da tek adımın) plan anlık görüntüsü, sıra düzeninde. */
export async function readStepSnapshotsTx(tx: Tx, workOrderId: string, stepId?: string): Promise<StepSnapshot[]> {
  const rows = await tx.workOrderStep.findMany({
    where: { workOrderId, ...(stepId ? { id: stepId } : {}) },
    orderBy: { stepSequence: "asc" },
    select: {
      id: true, stepSequence: true, notes: true, requiredCategoryId: true,
      plannedSubcontractorId: true, dispatchWithoutColor: true,
      station: { select: { name: true } },
      requiredCategory: { select: { name: true } },
      plannedSubcontractor: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, stepSequence: r.stepSequence, stationName: r.station.name, notes: r.notes,
    requiredCategoryId: r.requiredCategoryId, categoryName: r.requiredCategory?.name ?? null,
    plannedSubcontractorId: r.plannedSubcontractorId, subcontractorName: r.plannedSubcontractor?.name ?? null,
    dispatchWithoutColor: r.dispatchWithoutColor,
  }));
}

const routeLabel = (steps: StepSnapshot[]) => steps.map((s) => s.stationName).join(" → ").slice(0, 1000);
const sendLabel = (v: boolean) => (v ? "Renksiz sevk" : "Renkli sevk");

/** Aynı adımın iki hâli arasındaki plan alanı farkları. */
function stepFieldChanges(a: StepSnapshot, b: StepSnapshot): WorkOrderFieldChange[] {
  const out: WorkOrderFieldChange[] = [];
  if ((a.notes ?? null) !== (b.notes ?? null)) {
    const [from, to] = [a.notes?.slice(0, 1000) ?? null, b.notes?.slice(0, 1000) ?? null];
    out.push({ field: "notes", from, to, fromLabel: from, toLabel: to });
  }
  if (a.requiredCategoryId !== b.requiredCategoryId) {
    out.push({ field: "requiredCategoryId", from: a.requiredCategoryId, to: b.requiredCategoryId, fromLabel: a.categoryName, toLabel: b.categoryName });
  }
  if (a.plannedSubcontractorId !== b.plannedSubcontractorId) {
    out.push({ field: "plannedSubcontractorId", from: a.plannedSubcontractorId, to: b.plannedSubcontractorId, fromLabel: a.subcontractorName, toLabel: b.subcontractorName });
  }
  if (a.dispatchWithoutColor !== b.dispatchWithoutColor) {
    out.push({ field: "dispatchWithoutColor", from: String(a.dispatchWithoutColor), to: String(b.dispatchWithoutColor),
      fromLabel: sendLabel(a.dispatchWithoutColor), toLabel: sendLabel(b.dispatchWithoutColor) });
  }
  return out;
}

/**
 * Rota planının deftere düşen yarısı: istasyon sırası değiştiyse tek "route" satırı
 * (eski → yeni sıra), iki hâlde de bulunan adımın not/kategori/fasoncu/renksiz sevk
 * farkları adım başına. Dönüş: yazılan satır.
 */
export async function recordStepDiffTx(
  tx: Tx,
  workOrderId: string,
  rows: { before: StepSnapshot[]; after: StepSnapshot[] },
  ctx: WorkOrderEventCtx,
): Promise<number> {
  let written = 0;
  const [from, to] = [routeLabel(rows.before), routeLabel(rows.after)];
  if (from !== to) {
    await recordStepPlanChangesTx(tx, workOrderId, { step: null, changes: [{ field: "route", from, to, fromLabel: from, toLabel: to }] }, ctx);
    written++;
  }
  const beforeById = new Map(rows.before.map((s) => [s.id, s]));
  for (const b of rows.after) {
    const a = beforeById.get(b.id);
    const changes = a ? stepFieldChanges(a, b) : [];
    if (changes.length === 0) continue;
    await recordStepPlanChangesTx(tx, workOrderId, { step: { id: b.id, stepSequence: b.stepSequence, stationName: b.stationName }, changes }, ctx);
    written += changes.length;
  }
  return written;
}
