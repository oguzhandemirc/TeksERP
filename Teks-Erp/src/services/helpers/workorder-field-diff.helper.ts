// =============================================================================
// İş emri PLAN ALANLARININ deftere yazımı — önce/sonra satırından alan diff'i
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
async function labelChanges(tx: Tx, changes: (WorkOrderFieldChange & { field: WorkOrderTrackedField })[]): Promise<WorkOrderFieldChange[]> {
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
  const { before, after } = rows;
  const changes = WORK_ORDER_TRACKED_FIELDS.filter((f) => after[f] !== undefined)
    .map((field) => ({ field, from: canonicalValue(field, before[field]), to: canonicalValue(field, after[field]) }))
    .filter((c) => c.from !== c.to);
  if (changes.length === 0) return 0;
  await recordWorkOrderFieldChangesTx(tx, workOrderId, await labelChanges(tx, changes), ctx);
  return changes.length;
}
