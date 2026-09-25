// =============================================================================
// İŞ EMRİ HAREKETLERİ — zaman çizelgesi (docs/design/IS-EMRI-HAREKET-DEFTERI.md §3, §7)
// =============================================================================
// İki katman tek çizelgede: (A) iş emrinin KENDİ defteri `work_order_events`;
// (B) kendi defteri olan olaylar KAYNAKLARINDAN okunur — sipariş bağı, hedef
// özellik, parti doğuşu, fason sevk/kabul, Tambur kesimi, kapanış künyesi.
// Kopya yok (tek kaynak) ve audit OKUNMAZ (audit yalnız ayak izidir).
// Satır başlığı burada Türkçe kurulur; istemci ikinci sözlük tutmaz.
// =============================================================================

import { Prisma, RollEntrySource, WorkOrderEventType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { normalizeScanCode } from "../utils/code-format";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import { cancelReturnNote } from "./helpers/production-issue-ledger.helper";
import {
  TIMELINE_GROUPS,
  TIMELINE_GROUP_LABEL,
  WORK_ORDER_CHANNEL_LABEL,
  WORK_ORDER_FIELD_LABEL,
  WORK_ORDER_ROLL_ATTRIBUTE_LABEL,
  WORK_ORDER_STEP_FIELD_LABEL,
  WORK_ORDER_TRIGGER_LABEL,
  type TimelineGroup,
} from "../constants/workorder-event-labels";

export interface TimelineItem {
  /** Kaynak önekli tekil kimlik (`woe:<id>`, `link-in:<id>` …) — cursor bunun üstünde kurulur. */
  id: string;
  at: string;
  group: TimelineGroup;
  title: string;
  detail: string | null;
  reason: string | null;
  actor: string | null;
  channel: string | null;
  trigger: string | null;
  /** Geçmişten sonradan türetilmiş satır (backfill) — ekranda rozetle ayrılır. */
  derived: boolean;
  /** Belge düzeyi satırın topları (iptal dönüşü) — eski istemci yok sayar. */
  rolls?: Array<{ barcode: string | null; qty: number; to: string | null }>;
}

export interface TimelinePage {
  data: TimelineItem[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Süzgeç çipleri — süzgeçten BAĞIMSIZ total sayılar (tek where'den). */
  groups: Array<{ key: TimelineGroup; label: string; count: number }>;
}

const m = (d: Prisma.Decimal | number | null | undefined) =>
  d == null ? "—" : `${Number(d).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} m`;

type Pending = Omit<TimelineItem, "actor"> & { actorId: string | null };

function woEventItem(e: {
  id: string; type: WorkOrderEventType; field: string | null; fromValue: string | null; toValue: string | null;
  fromLabel: string | null; toLabel: string | null; trigger: string | null; channel: string; reason: string | null;
  payload?: Prisma.JsonValue | null; createdById: string | null; createdAt: Date;
}): Pending {
  const from = e.fromLabel ?? e.fromValue ?? "—";
  const to = e.toLabel ?? e.toValue ?? "—";
  const base = {
    id: `woe:${e.id}`, at: e.createdAt.toISOString(), reason: e.reason, actorId: e.createdById,
    channel: WORK_ORDER_CHANNEL_LABEL[e.channel] ?? e.channel,
    trigger: e.trigger ? (WORK_ORDER_TRIGGER_LABEL[e.trigger] ?? e.trigger) : null,
    derived: e.channel === "BACKFILL",
  };
  switch (e.type) {
    case WorkOrderEventType.CREATED:
      return { ...base, group: "DURUM", title: "İş emri açıldı", detail: e.toLabel };
    case WorkOrderEventType.STATUS_CHANGED:
      return { ...base, group: "DURUM", title: "Durum değişti", detail: `${from} → ${to}` };
    case WorkOrderEventType.BATCH_ADDED:
      return { ...base, group: "PARTI", title: "Parti eklendi", detail: e.toLabel };
    case WorkOrderEventType.STEP_PLAN_CHANGED: {
      const station = (e.payload as { stationName?: string } | null)?.stationName;
      const label = WORK_ORDER_STEP_FIELD_LABEL[e.field ?? ""] ?? e.field ?? "Adım";
      return { ...base, group: "PLAN", title: `${station ? `${station}: ` : ""}${label} değişti`, detail: `${from} → ${to}` };
    }
    case WorkOrderEventType.ROLL_ATTRIBUTES_APPLIED: {
      const n = (e.payload as { rolls?: unknown[] } | null)?.rolls?.length ?? 0;
      const label = WORK_ORDER_ROLL_ATTRIBUTE_LABEL[e.field ?? ""] ?? e.field ?? "değer";
      return { ...base, group: "PLAN", title: `Toplara ${label} uygulandı`, detail: `${to} · ${n} top` };
    }
    default: {
      const fieldLabel = e.field ? ((WORK_ORDER_FIELD_LABEL as Record<string, string>)[e.field] ?? e.field) : "Alan";
      return { ...base, group: e.field === "isActive" ? "DURUM" : "PLAN", title: `${fieldLabel} değişti`, detail: `${from} → ${to}` };
    }
  }
}

const NO_META = { reason: null, channel: null, trigger: null, derived: false } as const;

/** (B) katmanı — kendi defteri olan olaylar, kaynaklarından. */
async function sourcedItems(workOrderId: string, stepIds: string[]): Promise<Pending[]> {
  const out: Pending[] = [];
  // `unlinkedAt` SÜZÜLMEZ — geçmiş çizelgesi: koparılmış bağ da satırdır; karar/sayı üretmez.
  const links = await prisma.workOrderToOrderLine.findMany({
    where: { workOrderId },
    select: {
      id: true, createdAt: true, unlinkedAt: true, unlinkedById: true, unlinkReason: true,
      orderLine: { select: { quantity: true, order: { select: { orderNumber: true } }, item: { select: { name: true } } } },
    },
  });
  for (const l of links) {
    const label = `${l.orderLine.order.orderNumber} · ${l.orderLine.item?.name ?? "—"} · ${m(l.orderLine.quantity)}`;
    out.push({ ...NO_META, id: `link-in:${l.id}`, at: l.createdAt.toISOString(), group: "SIPARIS", title: "Sipariş bağlandı", detail: label, actorId: null });
    if (l.unlinkedAt) {
      out.push({ ...NO_META, id: `link-out:${l.id}`, at: l.unlinkedAt.toISOString(), group: "SIPARIS", title: "Sipariş bağı koparıldı", detail: label, reason: l.unlinkReason, actorId: l.unlinkedById });
    }
  }
  // `revokedAt` SÜZÜLMEZ — geçmiş çizelgesi: geri çekilen hedef özellik de satırdır.
  const props = await prisma.workOrderTargetProperty.findMany({
    where: { workOrderId },
    select: { id: true, createdAt: true, revokedAt: true, revokedById: true, revokeReason: true, property: { select: { name: true } } },
  });
  for (const p of props) {
    out.push({ ...NO_META, id: `prop-in:${p.id}`, at: p.createdAt.toISOString(), group: "PLAN", title: "Hedef özellik eklendi", detail: p.property.name, actorId: null });
    if (p.revokedAt) {
      out.push({ ...NO_META, id: `prop-out:${p.id}`, at: p.revokedAt.toISOString(), group: "PLAN", title: "Hedef özellik çıkarıldı", detail: p.property.name, reason: p.revokeReason, actorId: p.revokedById });
    }
  }
  const batches = await prisma.batch.findMany({
    where: { workOrderId },
    select: { id: true, batchNumber: true, createdAt: true, createdById: true },
  });
  for (const b of batches) {
    out.push({ ...NO_META, id: `batch:${b.id}`, at: b.createdAt.toISOString(), group: "PARTI", title: "Parti açıldı", detail: b.batchNumber, actorId: b.createdById });
  }
  // Top Çıkar: üretime giriş satırının bağlı tersi (stok defteri) — sebep satırın notunda.
  // İş emri iptalinin dönüşleri belge düzeyinde TEK satırdır (S6); anahtar iptalin notu.
  const detached = await prisma.warehouseMovement.findMany({
    where: { reasonCode: STOCK_MOVE_REASON.ROLL_DETACH, workOrderStepId: { in: stepIds } },
    select: { id: true, createdAt: true, userId: true, notes: true, qty: true, toStatus: true, roll: { select: { barcode: true } } },
    orderBy: { createdAt: "asc" },
  });
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { workOrderNumber: true } });
  const cancelNote = wo ? cancelReturnNote(wo.workOrderNumber) : null;
  const cancelReturns = detached.filter((d) => d.notes === cancelNote);
  for (const d of detached.filter((x) => x.notes !== cancelNote)) {
    out.push({ ...NO_META, id: `detach:${d.id}`, at: d.createdAt.toISOString(), group: "PARTI", title: "Top çıkarıldı", detail: `${d.roll?.barcode ?? "—"} · ${m(d.qty)}`, reason: d.notes, actorId: d.userId });
  }
  if (cancelReturns.length > 0) {
    const total = cancelReturns.reduce((s, d) => s + Number(d.qty), 0);
    out.push({
      ...NO_META, id: `cancel-return:${workOrderId}`, at: cancelReturns[0]!.createdAt.toISOString(), group: "PARTI",
      title: `İş emri iptali — ${cancelReturns.length} top kaynağına döndü`, detail: m(total), actorId: cancelReturns[0]!.userId,
      rolls: cancelReturns.map((d) => ({ barcode: d.roll?.barcode ?? null, qty: Number(d.qty), to: d.toStatus })),
    });
  }
  const dispatches = await prisma.subcontractorDispatch.findMany({
    where: { workOrderId },
    select: {
      id: true, dispatchNo: true, dispatchedAt: true, dispatchedById: true, totalQty: true, cancelledAt: true,
      cancelledById: true, cancelReason: true, subcontractor: { select: { name: true } }, _count: { select: { items: true } },
    },
  });
  for (const d of dispatches) {
    const label = `${d.dispatchNo} · ${d._count.items} top · ${m(d.totalQty)} → ${d.subcontractor.name}`;
    out.push({ ...NO_META, id: `disp:${d.id}`, at: d.dispatchedAt.toISOString(), group: "FASON", title: "Fasona sevk", detail: label, actorId: d.dispatchedById });
    if (d.cancelledAt) {
      out.push({ ...NO_META, id: `disp-x:${d.id}`, at: d.cancelledAt.toISOString(), group: "FASON", title: "Fason sevki iptal edildi", detail: d.dispatchNo, reason: d.cancelReason, actorId: d.cancelledById });
    }
  }
  const receipts = await prisma.subcontractorReceipt.findMany({
    where: { workOrderId },
    select: {
      id: true, receiptNo: true, receivedAt: true, receivedById: true, cancelledAt: true, cancelledById: true,
      cancelReason: true, subcontractor: { select: { name: true } }, _count: { select: { bornRolls: true } },
    },
  });
  for (const r of receipts) {
    const label = `${r.receiptNo} · ${r._count.bornRolls} top ← ${r.subcontractor.name}`;
    out.push({ ...NO_META, id: `rcpt:${r.id}`, at: r.receivedAt.toISOString(), group: "FASON", title: "Fason kabul", detail: label, actorId: r.receivedById });
    if (r.cancelledAt) {
      out.push({ ...NO_META, id: `rcpt-x:${r.id}`, at: r.cancelledAt.toISOString(), group: "FASON", title: "Fason kabulü iptal edildi", detail: r.receiptNo, reason: r.cancelReason, actorId: r.cancelledById });
    }
  }
  if (stepIds.length > 0) {
    // Belge düzeyi (kullanıcı kararı S6): bir kaynak topun kesimi = tek satır.
    const cuts = await prisma.roll.findMany({
      where: { producedInStepId: { in: stepIds }, entrySource: RollEntrySource.TAMBUR_SPLIT, parentRollId: { not: null } },
      select: { parentRollId: true, initialQty: true, createdAt: true, createdById: true, parent: { select: { barcode: true } } },
      orderBy: { createdAt: "asc" },
    });
    const byParent = new Map<string, typeof cuts>();
    for (const c of cuts) byParent.set(c.parentRollId!, [...(byParent.get(c.parentRollId!) ?? []), c]);
    for (const [parentId, kids] of byParent) {
      const total = kids.reduce((s, k) => s + Number(k.initialQty), 0);
      out.push({
        ...NO_META, id: `cut:${parentId}`, at: kids[0]!.createdAt.toISOString(), group: "TAMBUR", title: "Tambur kesimi",
        detail: `${kids[0]!.parent?.barcode ?? "—"} → ${kids.length} top · ${m(total)}`, actorId: kids[0]!.createdById,
      });
    }
  }
  const snaps = await prisma.workOrderCloseSnapshot.findMany({
    where: { workOrderId },
    select: { id: true, version: true, closeKind: true, rollCount: true, warehouseM: true, a1M: true, yieldPct: true, closedById: true, createdAt: true },
  });
  for (const s of snaps) {
    const yieldText = s.yieldPct != null ? ` · verim %${Number(s.yieldPct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}` : "";
    const backfill = s.closeKind === "BACKFILL";
    out.push({
      ...NO_META, id: `snap:${s.id}`, at: s.createdAt.toISOString(), group: "KAPANIS",
      title: backfill ? "Kapanış künyesi (yaklaşık)" : `Kapanış künyesi (${s.version}. kapanış)`,
      detail: `${s.rollCount} top · ${m(Number(s.warehouseM) + Number(s.a1M))}${yieldText}`, actorId: s.closedById,
      derived: backfill, channel: backfill ? WORK_ORDER_CHANNEL_LABEL.BACKFILL : null,
    });
  }
  return out;
}

export const encodeCursor = (i: Pick<TimelineItem, "at" | "id">) => Buffer.from(`${i.at}|${i.id}`).toString("base64url");
const decodeCursor = (c: string): [string, string] => {
  const raw = Buffer.from(c, "base64url").toString("utf8");
  const k = raw.indexOf("|");
  if (k < 0) throw AppError.badRequest("Geçersiz sayfa imleci");
  return [raw.slice(0, k), raw.slice(k + 1)];
};

/** Yeni → eski; eşit anlarda kimlik sırası (kararlı cursor). SAF. */
export function pageTimeline(
  items: TimelineItem[],
  opts: { groups?: TimelineGroup[]; cursor?: string; limit: number },
): TimelinePage {
  const sorted = [...items].sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  const groups = TIMELINE_GROUPS.map((key) => ({
    key, label: TIMELINE_GROUP_LABEL[key], count: sorted.filter((i) => i.group === key).length,
  }));
  let rows = opts.groups?.length ? sorted.filter((i) => opts.groups!.includes(i.group)) : sorted;
  if (opts.cursor) {
    const [at, id] = decodeCursor(opts.cursor);
    rows = rows.filter((i) => i.at < at || (i.at === at && i.id < id));
  }
  const data = rows.slice(0, opts.limit);
  const hasMore = rows.length > opts.limit;
  return { data, hasMore, nextCursor: hasMore ? encodeCursor(data[data.length - 1]!) : null, groups };
}

export interface TimelineLookupHit {
  id: string;
  workOrderNumber: string;
  status: string;
  createdAt: string;
  /** Neyle bulundu — iş emri no mu, topun geçtiği iş emri mi. */
  via: "WORK_ORDER_NUMBER" | "ROLL_BARCODE";
}

export class WorkOrderTimelineService {
  /**
   * Hareketler ekranının araması: önce iş emri no (tam eşleşme), yoksa top
   * barkodu → topun geçtiği TÜM iş emirleri (hareket adımları ∪ bugünkü adım ∪
   * doğduğu adım). Yeni → eski.
   */
  async lookup(query: string): Promise<TimelineLookupHit[]> {
    const code = normalizeScanCode(query);
    if (code.length < 2) throw AppError.badRequest("En az 2 karakter girin (iş emri no ya da top barkodu)");
    const select = { id: true, workOrderNumber: true, status: true, createdAt: true } as const;
    const byNumber = await prisma.workOrder.findMany({ where: { workOrderNumber: code }, select });
    if (byNumber.length > 0) {
      return byNumber.map((w) => ({ ...w, createdAt: w.createdAt.toISOString(), via: "WORK_ORDER_NUMBER" as const }));
    }
    const roll = await prisma.roll.findFirst({
      where: { barcode: code },
      select: {
        id: true,
        currentStep: { select: { workOrderId: true } },
        producedInStep: { select: { workOrderId: true } },
      },
    });
    if (!roll) return [];
    // `revokedAt` SÜZÜLMEZ — topun uğradığı iş emirleri: geri alınmış hareket de geçmiştir.
    const moves = await prisma.rollMovement.findMany({
      where: { rollId: roll.id },
      select: { step: { select: { workOrderId: true } } },
    });
    const ids = new Set<string>(moves.map((mv) => mv.step.workOrderId));
    if (roll.currentStep) ids.add(roll.currentStep.workOrderId);
    if (roll.producedInStep) ids.add(roll.producedInStep.workOrderId);
    if (ids.size === 0) return [];
    const wos = await prisma.workOrder.findMany({ where: { id: { in: [...ids] } }, select, orderBy: { createdAt: "desc" } });
    return wos.map((w) => ({ ...w, createdAt: w.createdAt.toISOString(), via: "ROLL_BARCODE" as const }));
  }

  async list(
    workOrderId: string,
    opts: { groups?: TimelineGroup[]; cursor?: string; limit: number },
  ): Promise<TimelinePage> {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, steps: { select: { id: true } } } });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    const events = await prisma.workOrderEvent.findMany({ where: { workOrderId } });
    const pending: Pending[] = [...events.map(woEventItem), ...(await sourcedItems(workOrderId, wo.steps.map((s) => s.id)))];
    const actorIds = [...new Set(pending.map((p) => p.actorId).filter((x): x is string => !!x))];
    const users = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, username: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));
    const items: TimelineItem[] = pending.map(({ actorId, ...rest }) => ({ ...rest, actor: actorId ? (nameById.get(actorId) ?? null) : null }));
    return pageTimeline(items, opts);
  }
}
