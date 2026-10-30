// =============================================================================
// GELEN BELGEDEN İŞ EMRİ — salt okunur PLAN (D4-D2; DALGA4 §5.3 seçenek c, §5.5 md. 4)
// =============================================================================
// Onaylı (APPROVED/PARTIAL) belgenin doğurduğu topları İŞLEM DEĞERİNE (desen / gramaj; `suggestProcess`: önce
// PROCESS sözlüğü = onayda öğretilen, sonra kalıp) ve ürüne göre gruplar. Bu dosya HİÇBİR ŞEY YAZMAZ: iş emri
// panelden grup başına MEVCUT `quickStart` ile açılır (grup başına clientToken, hedef = `targetValues`) — ikinci
// iş emri yaratıcısı yoktur. Bağlanabilirlik `quickStart`ın kabul kümesiyle (ATTACHABLE_ROLL_STATUSES) aynıdır.
// =============================================================================
import { DeliveryNoteStatus, type Prisma, type RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { effectiveProcessText } from "../lib/gelen-belge/gramaj-oneri";
import { AppError } from "../utils/app-error";
import { suggestProcess, type ProcessSuggestion } from "./gelen-belge-eslestirme.service";
import { loadKursunGramajOptions } from "./helpers/kursun-bypass-gramaj.helper";
import { loadProcessChoiceGroups, PROCESS_CHOICE_VALUE_WHERE } from "./helpers/process-choice-catalog.helper";
import { customerBatchKeyOf } from "./helpers/ship-readiness.helper";
import { ATTACHABLE_ROLL_STATUSES } from "./workorder-batch-add.service";

/** İş emri planı yalnız top doğurmuş belgede anlamlıdır. */
export const WORK_ORDER_PLAN_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];

export interface PlanTarget {
  readonly propertyId: string;
  readonly propertyName: string;
  /** Çeşidin bağlı olduğu bayrak (BRODE, KURŞUN…) — iş emrinin hedef özelliği; rota kapsaması uyarısı bundan. */
  readonly flagPropertyId: string;
  readonly valueId: string;
  readonly valueName: string;
  readonly source: "ALIAS" | "PATTERN";
}

export interface PlanRoll {
  readonly rollId: string;
  readonly barcode: string | null;
  readonly lineNo: number;
  readonly senderRollNo: string | null;
  readonly meters: string;
  readonly status: RollStatus;
  /** `quickStart` bu topu kabul eder mi (stok/depo, çuvalda/sevkte değil, barkodlu). */
  readonly attachable: boolean;
  /** Top şu an bir iş emri adımındaysa o iş emri (başka canlı iş emrine ikinci kez bağlanamaz). */
  readonly liveWorkOrder: { readonly id: string; readonly workOrderNumber: string } | null;
}

export interface PlanGroup {
  /** Ürün + sıralı değer kimlikleri — panelin grup token anahtarı (aynı belge, aynı grup → aynı anahtar). */
  readonly key: string;
  /** İşlem değeri çözülemeyen satırlar ("desensiz") — ayrı listelenir, değer panelde seçilebilir. */
  readonly patternless: boolean;
  readonly targets: ReadonlyArray<PlanTarget>;
  readonly itemId: string;
  readonly itemName: string;
  readonly processText: string | null;
  readonly rolls: ReadonlyArray<PlanRoll>;
  readonly totalMeters: string;
  readonly attachableCount: number;
}

export interface WorkOrderPlan {
  readonly noteId: string;
  readonly noteNo: string;
  readonly status: DeliveryNoteStatus;
  readonly owner: { readonly id: string; readonly name: string } | null;
  /** Müşteri partisi (sahip + belge parti no; `customerBatchKeyOf`) — parti nosu yoksa null. */
  readonly customerBatch: { readonly key: string; readonly batchNo: string } | null;
  /** Aynı sahibin son iş emrindeki (aktif) rota şablonu — yalnız ÖNERİ, seçim kullanıcıda. */
  readonly suggestedRouteTemplateId: string | null;
  /** Değer seçilebilecek çeşit özellikleri (kurşun gramajı dahil); büyük katalog panelde sunucu aramasıyla. */
  readonly choiceProperties: ReadonlyArray<{ readonly propertyId: string; readonly propertyName: string; readonly flagPropertyId: string; readonly optionCount: number }>;
  readonly groups: ReadonlyArray<PlanGroup>;
}

type Picked = { valueId: string; source: "ALIAS" | "PATTERN" };

/** Satırın işlem önerisinden seçilmiş değerler (kurşun + her çeşit; NONE atlanır). */
function pickedValues(s: ProcessSuggestion): Picked[] {
  const out: Picked[] = [];
  if (s.suggested && s.source !== "NONE") out.push({ valueId: s.suggested.id, source: s.source });
  for (const v of s.variants ?? []) if (v.suggested && v.source !== "NONE") out.push({ valueId: v.suggested.id, source: v.source });
  return out;
}

/** Saf: grup anahtarı — ürün + sıralı değerler; değersiz grup `-`. */
export function planGroupKey(itemId: string, valueIds: readonly string[]): string {
  return `${itemId}|${valueIds.length > 0 ? [...valueIds].sort().join(",") : "-"}`;
}

async function suggestRouteTemplate(ownerCustomerId: string | null): Promise<string | null> {
  if (!ownerCustomerId) return null;
  const last = await prisma.workOrder.findFirst({
    where: { routeTemplateId: { not: null }, routeTemplate: { isActive: true }, batches: { some: { rolls: { some: { ownerCustomerId } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { routeTemplateId: true },
  });
  return last?.routeTemplateId ?? null;
}

const PLAN_NOTE_SELECT = {
  id: true, noteNo: true, status: true, ownerCustomerId: true, senderCustomerId: true, customerBatchNo: true, processText: true,
  ownerCustomer: { select: { id: true, name: true } },
  lines: {
    where: { rollId: { not: null } },
    orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }],
    select: {
      lineNo: true, senderRollNo: true, processText: true,
      roll: {
        select: {
          id: true, barcode: true, status: true, currentQty: true, itemId: true, sackId: true, shipmentId: true,
          item: { select: { name: true } },
          currentStep: { select: { workOrder: { select: { id: true, workOrderNumber: true } } } },
        },
      },
    },
  },
} as const satisfies Prisma.CustomerDeliveryNoteSelect;

export async function buildWorkOrderPlan(noteId: string): Promise<WorkOrderPlan> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: PLAN_NOTE_SELECT,
  });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  if (!WORK_ORDER_PLAN_STATUSES.includes(note.status)) {
    throw AppError.conflict("İş emri yalnız onaylanmış (top doğmuş) belgeden açılır.", { code: "DELIVERY_NOTE_NOT_APPROVED" });
  }
  const gramajOptions = await loadKursunGramajOptions();
  const choiceGroups = await loadProcessChoiceGroups();
  // Aynı metin satırlarda tekrar eder → metin başına bir çözüm (sözlük sorgusu satır başına değil).
  const cache = new Map<string, ProcessSuggestion>();
  const perLine: Array<{ line: (typeof note.lines)[number]; text: string | null; picked: Picked[] }> = [];
  for (const line of note.lines) {
    const text = effectiveProcessText(line.processText, note.processText);
    const k = text ?? "";
    if (!cache.has(k)) cache.set(k, await suggestProcess(text, note.senderCustomerId, gramajOptions, choiceGroups));
    perLine.push({ line, text, picked: pickedValues(cache.get(k)!) });
  }
  const valueIds = [...new Set(perLine.flatMap((p) => p.picked.map((x) => x.valueId)))];
  const values = valueIds.length === 0 ? [] : await prisma.fabricPropertyValue.findMany({
    where: { id: { in: valueIds } },
    select: { id: true, name: true, propertyId: true, property: { select: { name: true, variantOfPropertyId: true } } },
  });
  const valueById = new Map(values.map((v) => [v.id, v]));

  const groups = new Map<string, { targets: PlanTarget[]; itemId: string; itemName: string; processText: string | null; rolls: PlanRoll[]; meters: number }>();
  for (const { line, text, picked } of perLine) {
    const roll = line.roll!;
    const targets = picked
      .map((p): PlanTarget | null => {
        const v = valueById.get(p.valueId);
        if (!v?.property.variantOfPropertyId) return null;
        return { propertyId: v.propertyId, propertyName: v.property.name, flagPropertyId: v.property.variantOfPropertyId, valueId: v.id, valueName: v.name, source: p.source };
      })
      .filter((t): t is PlanTarget => t !== null)
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName, "tr"));
    const key = planGroupKey(roll.itemId, targets.map((t) => t.valueId));
    const attachable = ATTACHABLE_ROLL_STATUSES.includes(roll.status) && !roll.sackId && !roll.shipmentId && !!roll.barcode;
    const planRoll: PlanRoll = {
      rollId: roll.id, barcode: roll.barcode, lineNo: line.lineNo, senderRollNo: line.senderRollNo, meters: roll.currentQty.toFixed(2),
      status: roll.status, attachable, liveWorkOrder: roll.currentStep?.workOrder ?? null,
    };
    const g = groups.get(key);
    if (g) {
      g.rolls.push(planRoll);
      g.meters += Number(roll.currentQty);
    } else {
      groups.set(key, { targets, itemId: roll.itemId, itemName: roll.item.name, processText: text, rolls: [planRoll], meters: Number(roll.currentQty) });
    }
  }
  const batchKey = customerBatchKeyOf(note.ownerCustomerId, note.customerBatchNo);
  return {
    noteId: note.id,
    noteNo: note.noteNo,
    status: note.status,
    owner: note.ownerCustomer,
    customerBatch: batchKey ? { key: batchKey, batchNo: note.customerBatchNo!.trim() } : null,
    suggestedRouteTemplateId: await suggestRouteTemplate(note.ownerCustomerId),
    choiceProperties: await loadChoiceProperties(),
    // Desenli gruplar önce (belge sırası korunur), desensiz grup(lar) en sonda ayrı.
    groups: [...groups.entries()]
      .map(([key, g]): PlanGroup => ({
        key, patternless: g.targets.length === 0, targets: g.targets, itemId: g.itemId, itemName: g.itemName, processText: g.processText,
        rolls: g.rolls, totalMeters: g.meters.toFixed(2), attachableCount: g.rolls.filter((r) => r.attachable).length,
      }))
      .sort((a, b) => Number(a.patternless) - Number(b.patternless)),
  };
}

/** Kurşun gramaj özelliği + kurşun dışı çeşitler (`PROCESS_CHOICE_VALUE_WHERE.property` ile aynı küme) — panelin "değer seç" listesi. */
async function loadChoiceProperties(): Promise<WorkOrderPlan["choiceProperties"]> {
  const rows = await prisma.fabricProperty.findMany({
    where: { ...PROCESS_CHOICE_VALUE_WHERE.property, values: { some: { isActive: true } } },
    select: { id: true, name: true, variantOfPropertyId: true, _count: { select: { values: { where: { isActive: true } } } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map((p) => ({ propertyId: p.id, propertyName: p.name, flagPropertyId: p.variantOfPropertyId!, optionCount: p._count.values }));
}
