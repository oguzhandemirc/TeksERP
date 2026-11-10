// =============================================================================
// TAMBUR ETİKET ÖNERİLERİ — kumaş adı / renk / parti no (Gülkesim 2026-11-09)
// =============================================================================
// Tamburcu müşteriyi arayıp etikete basılacak adı soruyor; aynı müşterinin son 180 günde
// topa yazılmış değerleri seçici listesine gelir. "Yapışkan" değer İE'de SAKLANMAZ: `last`
// bu İE'de bu alanlardan birini taşıyan en son topun değerleridir (tek kaynak = top).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

export const LABEL_SUGGESTION_DAYS = 180;
export const LABEL_SUGGESTION_LIMIT = 20;
const LABEL_SUGGESTION_SCAN = 1000;

type LabelField = "labelItemName" | "labelColorName" | "labelBatchNo";

export interface TamburLabelSuggestions {
  workOrderId: string | null;
  customerIds: string[];
  itemNames: string[];
  colorNames: string[];
  batchNos: string[];
  last: { itemName: string | null; colorName: string | null; batchNo: string | null; consigneeId: string | null; consigneeName: string | null; templateId: string | null } | null;
}

/** İE (ya da top üzerinden İE) + müşteri kümesi: İE müşterisi ∪ İE partilerindeki topların sahibi (fason). */
async function resolveScope(args: { workOrderId?: string | null; rollId?: string | null }): Promise<{ workOrderId: string | null; customerIds: string[] }> {
  const customers = new Set<string>();
  let workOrderId = args.workOrderId ?? null;
  if (args.rollId) {
    const roll = await prisma.roll.findUnique({
      where: { id: args.rollId },
      select: { ownerCustomerId: true, labelCustomerId: true, batch: { select: { workOrderId: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.ownerCustomerId) customers.add(roll.ownerCustomerId);
    if (roll.labelCustomerId) customers.add(roll.labelCustomerId);
    workOrderId ??= roll.batch?.workOrderId ?? null;
  }
  if (workOrderId) {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, customerId: true } });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (wo.customerId) customers.add(wo.customerId);
    const owners = await prisma.roll.findMany({
      where: { batch: { workOrderId }, ownerCustomerId: { not: null } },
      select: { ownerCustomerId: true },
      distinct: ["ownerCustomerId"],
      take: 10,
    });
    for (const o of owners) if (o.ownerCustomerId) customers.add(o.ownerCustomerId);
  }
  return { workOrderId, customerIds: [...customers].sort() };
}

/** Tekil değerler, satır sırası korunur (en son kullanılan önce), en çok LIMIT. */
function distinctOrdered(rows: ReadonlyArray<Record<LabelField, string | null>>, field: LabelField): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[field];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= LABEL_SUGGESTION_LIMIT) break;
  }
  return out;
}

/** `consigneeId` verilirse öneriler o alıcının toplarından (emanet: alıcı başına ad/renk); yoksa sahip/İE kapsamı. */
export async function getTamburLabelSuggestions(args: { workOrderId?: string | null; rollId?: string | null; consigneeId?: string | null }): Promise<TamburLabelSuggestions> {
  const { workOrderId, customerIds } = await resolveScope(args);
  const or: Prisma.RollWhereInput[] = [];
  if (customerIds.length > 0) {
    or.push({ ownerCustomerId: { in: customerIds } }, { labelCustomerId: { in: customerIds } });
  }
  if (workOrderId) or.push({ batch: { workOrderId } });
  if (or.length === 0 && !args.consigneeId) {
    return { workOrderId, customerIds, itemNames: [], colorNames: [], batchNos: [], last: null };
  }
  const since = new Date(Date.now() - LABEL_SUGGESTION_DAYS * 24 * 60 * 60 * 1000);
  const scope: Prisma.RollWhereInput = args.consigneeId
    ? { createdAt: { gte: since }, labelConsigneeId: args.consigneeId }
    : { createdAt: { gte: since }, OR: or };
  // Tek sorgu + bellekte tekilleştirme: tavan, öneri listesi için yeterli derinlik (20 tekil × 3 alan).
  const rows = await prisma.roll.findMany({
    where: {
      AND: [scope, { OR: [{ labelItemName: { not: null } }, { labelColorName: { not: null } }, { labelBatchNo: { not: null } }] }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { labelItemName: true, labelColorName: true, labelBatchNo: true },
    take: LABEL_SUGGESTION_SCAN,
  });
  const itemNames = distinctOrdered(rows, "labelItemName");
  const colorNames = distinctOrdered(rows, "labelColorName");
  const batchNos = distinctOrdered(rows, "labelBatchNo");

  let last: TamburLabelSuggestions["last"] = null;
  if (workOrderId) {
    const r = await prisma.roll.findFirst({
      where: {
        batch: { workOrderId },
        OR: [{ labelItemName: { not: null } }, { labelColorName: { not: null } }, { labelBatchNo: { not: null } }, { labelConsigneeId: { not: null } }, { labelTemplateId: { not: null } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { labelItemName: true, labelColorName: true, labelBatchNo: true, labelConsigneeId: true, labelConsignee: { select: { name: true } }, labelTemplateId: true },
    });
    if (r) {
      last = {
        itemName: r.labelItemName, colorName: r.labelColorName, batchNo: r.labelBatchNo,
        consigneeId: r.labelConsigneeId, consigneeName: r.labelConsignee?.name ?? null,
        // İE'nin son kesiminde seçilen şablon (çoklu etiket) — tablet yeniden açılınca buradan başlar.
        templateId: r.labelTemplateId,
      };
    }
  }
  return { workOrderId, customerIds, itemNames, colorNames, batchNos, last };
}
