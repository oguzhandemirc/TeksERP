// =============================================================================
// ONAYLI GELEN BELGE İPTALİ — DEĞERLENDİRME + ÖNİZLEME (K15, kullanıcı kararı 2026-11-02 "a")
// =============================================================================
// Önizleme ile iptal AYNI yüklemden geçer (`evaluateNoteCancel`): önizleme `prisma` ile okur, iptal claim'den
// sonra tx içinde YENİDEN okur — bayat önizleme kapı değildir. Engel kuralı fail-closed: belgeden doğan top
// yalnız ham stokta (STOCK, depolu, çuval/sevk/işlem izi yok) ya da BAŞLAMAMIŞ ve SEÇİLMİŞ iş emrindeyse düşer.
// =============================================================================
import { DeliveryNoteStatus, type Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ACTIVE_MOVEMENT } from "./helpers/roll-movement.helper";
import { isWorkOrderUnprocessed } from "./helpers/workorder-locks.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** İptal edilebilir belge durumları — claim WHERE'i ve önizleme aynı kümeyi okur. */
export const CANCELLABLE_NOTE_STATUSES: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.PARTIAL];
/** Bu iş emirleri "geçmiş"tir: içlerinde hareketi olan top işlem görmüştür (iptal edilmiş iş emri iz değildir). */
const CLOSED_WO: readonly WorkOrderStatus[] = [WorkOrderStatus.COMPLETED, WorkOrderStatus.SUPERSEDED];

export type CancelBlockerCode =
  | "ROLL_STATUS" | "ROLL_IN_SHIPMENT" | "ROLL_WAREHOUSE_MISSING" | "ROLL_OPERATION" | "ROLL_METER_READING"
  | "ROLL_SERVICE_BILLING" | "ROLL_SUBCONTRACTOR_DISPATCH" | "ROLL_KARTELA_DISPATCH" | "ROLL_RETURN" | "ROLL_CHILDREN"
  | "ROLL_PROCESSED" | "WORK_ORDER_STARTED" | "WORK_ORDER_NOT_SELECTED";

export interface CancelBlocker {
  readonly code: CancelBlockerCode;
  /** Türkçe: ne engelliyor + ne yapılmalı. */
  readonly message: string;
  readonly rollId?: string;
  readonly workOrderId?: string;
}

export interface CancelPreviewRoll {
  readonly rollId: string;
  readonly barcode: string | null;
  readonly lineNo: number;
  readonly senderRollNo: string | null;
  readonly meters: string;
  readonly status: RollStatus;
  /** Şu an nerede (depo / istasyon + iş emri / çuval) — insan okur. */
  readonly location: string | null;
  /** `CANCEL` ters kayıtla düşer · `SKIP` zaten iptal · `BLOCKED` engel listesinde. */
  readonly outcome: "CANCEL" | "SKIP" | "BLOCKED";
  readonly blockers: ReadonlyArray<CancelBlocker>;
}

export interface CancelPreviewWorkOrder {
  readonly id: string;
  readonly workOrderNumber: string;
  readonly status: WorkOrderStatus;
  /** İşlem görmemiş (`isWorkOrderUnprocessed`: top bağlı olabilir, işlem izi yok) — belgeyle birlikte iptal için SEÇİLEBİLİR. */
  readonly selectable: boolean;
  readonly noteRollCount: number;
  /** Bu iş emrindeki BAŞKA kaynaklı top sayısı — iş emri iptal edilirse onlar ham stoka döner. */
  readonly otherRollCount: number;
  readonly effect: string;
}

export interface NoteCancelPreview {
  readonly note: { readonly id: string; readonly noteNo: string; readonly status: DeliveryNoteStatus; readonly senderDocNo: string | null; readonly ownerName: string | null };
  /** Sert engel yok — seçilebilir iş emirleri seçilince iptal geçer. */
  readonly cancellable: boolean;
  readonly rolls: ReadonlyArray<CancelPreviewRoll>;
  readonly workOrders: ReadonlyArray<CancelPreviewWorkOrder>;
  readonly blockers: ReadonlyArray<CancelBlocker>;
  readonly summary: { readonly rollCount: number; readonly cancelRollCount: number; readonly cancelMeters: string; readonly workOrderCount: number };
}

const ROLL_SELECT = {
  id: true, barcode: true, status: true, currentQty: true, warehouseId: true, sackId: true, shipmentId: true, directShipmentId: true,
  warehouse: { select: { name: true } },
  sack: { select: { sackNo: true } },
  currentStep: { select: { workOrderId: true, station: { select: { name: true } }, workOrder: { select: { workOrderNumber: true } } } },
  movements: { where: { ...ACTIVE_MOVEMENT }, select: { step: { select: { workOrderId: true, workOrder: { select: { status: true } } } } } },
  _count: {
    select: {
      operations: { where: { revokedAt: null } },
      meterReadings: { where: { revokedAt: null } },
      serviceBillingLinks: { where: { revokedAt: null } },
      dispatchItems: { where: { dispatch: { cancelledAt: null } } },
      kartelaDispatchItems: { where: { dispatch: { cancelledAt: null } } },
      returns: { where: { cancelledAt: null } },
      children: true,
    },
  },
} satisfies Prisma.RollSelect;
type RollRow = Prisma.RollGetPayload<{ select: typeof ROLL_SELECT }>;

export interface NoteCancelContext {
  readonly note: NoteCancelPreview["note"];
  readonly lines: ReadonlyArray<{ lineNo: number; senderRollNo: string | null; meters: Prisma.Decimal; roll: RollRow }>;
}

/** Belge + doğurduğu toplar; yoksa 404. `db` iptalde tx'tir (claim'den sonra taze okuma). */
export async function loadNoteCancelContext(db: Db, noteId: string): Promise<NoteCancelContext> {
  const n = await db.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, noteNo: true, status: true, senderDocNo: true, ownerCustomer: { select: { name: true } },
      lines: { where: { rollId: { not: null } }, orderBy: { lineNo: "asc" }, select: { lineNo: true, senderRollNo: true, meters: true, roll: { select: ROLL_SELECT } } },
    },
  });
  if (!n) throw AppError.notFound("Gelen belge bulunamadı", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const lines = n.lines.flatMap((l) => (l.roll ? [{ lineNo: l.lineNo, senderRollNo: l.senderRollNo, meters: l.meters, roll: l.roll }] : []));
  return { note: { id: n.id, noteNo: n.noteNo, status: n.status, senderDocNo: n.senderDocNo, ownerName: n.ownerCustomer?.name ?? null }, lines };
}

const tag = (r: RollRow) => r.barcode ?? r.id.slice(0, 8);

/** Topun durum/bağ engelleri (iş emri ekseni hariç) — her biri ne yapılacağını söyler. */
function rollBlockers(r: RollRow): CancelBlocker[] {
  const b: CancelBlocker[] = [];
  const add = (code: CancelBlockerCode, message: string) => b.push({ code, message: `${tag(r)}: ${message}`, rollId: r.id });
  if (r.status !== RollStatus.STOCK && r.status !== RollStatus.IN_PRODUCTION) {
    add("ROLL_STATUS", `top ham stokta değil (${r.status}) — işlem görmüş mal belgeyle düşürülemez; önce o işlemi geri alın.`);
  }
  if (r.sackId || r.shipmentId || r.directShipmentId) add("ROLL_IN_SHIPMENT", "top çuvala/sevkiyata bağlı — önce çuvaldan/sevkten çıkarın.");
  if (r.status === RollStatus.STOCK && !r.warehouseId) add("ROLL_WAREHOUSE_MISSING", "topun deposu yok — önce depo atayın (stok çıkışı depo ister).");
  const c = r._count;
  if (c.operations > 0) add("ROLL_OPERATION", "topta işlem kaydı var (kurşun/kalite/tambur) — önce işlemi geri alın.");
  if (c.meterReadings > 0) add("ROLL_METER_READING", "topta metre okuması var — önce okumayı geri alın.");
  if (c.serviceBillingLinks > 0) add("ROLL_SERVICE_BILLING", "top hizmet faturasına bağlı — önce fatura bağını geri alın.");
  if (c.dispatchItems > 0) add("ROLL_SUBCONTRACTOR_DISPATCH", "top fason sevkinde — önce fason sevkini iptal edin.");
  if (c.kartelaDispatchItems > 0) add("ROLL_KARTELA_DISPATCH", "top kartela sevkinde — önce kartela sevkini iptal edin.");
  if (c.returns > 0) add("ROLL_RETURN", "topun iade kaydı var — önce iadeyi iptal edin.");
  if (c.children > 0) add("ROLL_CHILDREN", "toptan yeni top doğmuş (bölme/fason dönüşü) — önce o işlemi geri alın.");
  if (r.movements.some((m) => m.step && CLOSED_WO.includes(m.step.workOrder.status))) {
    add("ROLL_PROCESSED", "top tamamlanmış/devredilmiş bir iş emrinde işlem görmüş — belgeyle düşürülemez.");
  }
  return b;
}

/** Topun bağlı olduğu canlı iş emirleri (şu anki adım + aktif hareketler; iptal/kapalı olanlar hariç). */
function liveWorkOrderIds(r: RollRow): string[] {
  const ids = new Set<string>();
  if (r.currentStep) ids.add(r.currentStep.workOrderId);
  for (const m of r.movements) if (m.step && m.step.workOrder.status !== WorkOrderStatus.CANCELLED && !CLOSED_WO.includes(m.step.workOrder.status)) ids.add(m.step.workOrderId);
  return [...ids];
}

function rollLocation(r: RollRow): string | null {
  if (r.sack) return `Çuval ${r.sack.sackNo}`;
  if (r.currentStep) return `${r.currentStep.station?.name ?? "İstasyon"} · ${r.currentStep.workOrder.workOrderNumber}`;
  return r.warehouse?.name ?? null;
}

async function loadWorkOrders(db: Db, ids: string[], noteRollIds: Set<string>): Promise<CancelPreviewWorkOrder[]> {
  if (ids.length === 0) return [];
  const wos = await db.workOrder.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
    select: { id: true, workOrderNumber: true, status: true, steps: { select: { currentRolls: { select: { id: true } } } } },
  });
  const out: CancelPreviewWorkOrder[] = [];
  for (const w of wos) {
    const rollIds = new Set(w.steps.flatMap((s) => s.currentRolls.map((r) => r.id)));
    const noteRollCount = [...rollIds].filter((id) => noteRollIds.has(id)).length;
    const otherRollCount = rollIds.size - noteRollCount;
    const selectable = await isWorkOrderUnprocessed(db, w.id, w.status);
    const effect = selectable
      ? `Birlikte iptal edilir${otherRollCount > 0 ? `; bu iş emrindeki başka ${otherRollCount} top ham stoka döner` : ""}.`
      : "İş emrinde işlem başlamış — belge iptal edilemez; önce işlemi geri alın ya da iş emrini kapatın.";
    out.push({ id: w.id, workOrderNumber: w.workOrderNumber, status: w.status, selectable, noteRollCount, otherRollCount, effect });
  }
  return out;
}

/**
 * Önizleme ile iptalin ORTAK yüklemi. `selected` verilirse (iptal yolu) seçilmeyen başlamamış iş emri de engeldir;
 * önizlemede (`selected` yok) o eksen engel değil seçim sorusudur.
 */
export async function evaluateNoteCancel(db: Db, ctx: NoteCancelContext, selected?: ReadonlySet<string>): Promise<NoteCancelPreview> {
  const noteRollIds = new Set(ctx.lines.map((l) => l.roll.id));
  const live = ctx.lines.filter((l) => l.roll.status !== RollStatus.CANCELLED);
  const woIds = [...new Set(live.flatMap((l) => liveWorkOrderIds(l.roll)))];
  const workOrders = await loadWorkOrders(db, woIds, noteRollIds);
  const woById = new Map(workOrders.map((w) => [w.id, w]));
  const blockers: CancelBlocker[] = [];
  for (const w of workOrders) {
    if (!w.selectable) blockers.push({ code: "WORK_ORDER_STARTED", message: `${w.workOrderNumber}: ${w.effect}`, workOrderId: w.id });
    else if (selected && !selected.has(w.id)) {
      blockers.push({ code: "WORK_ORDER_NOT_SELECTED", message: `${w.workOrderNumber}: belgenin topları bu açık iş emrinde — iptal için iş emrini de seçin.`, workOrderId: w.id });
    }
  }
  let cancelMeters = 0;
  const rolls: CancelPreviewRoll[] = ctx.lines.map((l) => {
    const r = l.roll;
    const base = { rollId: r.id, barcode: r.barcode, lineNo: l.lineNo, senderRollNo: l.senderRollNo, meters: r.currentQty.toString(), status: r.status, location: rollLocation(r) };
    if (r.status === RollStatus.CANCELLED) return { ...base, outcome: "SKIP" as const, blockers: [] };
    const own = rollBlockers(r);
    if (r.status === RollStatus.IN_PRODUCTION && liveWorkOrderIds(r).every((id) => !woById.get(id)?.selectable)) {
      own.push({ code: "ROLL_STATUS", message: `${tag(r)}: top işlem görmüş bir iş emrinde — önce iş emrindeki işlemi geri alın ya da topu iş emrinden çıkarın.`, rollId: r.id });
    }
    blockers.push(...own);
    if (own.length === 0) cancelMeters += Number(r.currentQty);
    return { ...base, outcome: own.length > 0 ? ("BLOCKED" as const) : ("CANCEL" as const), blockers: own };
  });
  const hard = blockers.filter((b) => b.code !== "WORK_ORDER_NOT_SELECTED");
  return {
    note: ctx.note,
    cancellable: CANCELLABLE_NOTE_STATUSES.includes(ctx.note.status) && hard.length === 0,
    rolls,
    workOrders,
    blockers,
    summary: { rollCount: rolls.length, cancelRollCount: rolls.filter((r) => r.outcome === "CANCEL").length, cancelMeters: cancelMeters.toFixed(3), workOrderCount: workOrders.length },
  };
}

/** GET …/iptal-onizleme — YAZMAZ. Taslak/iptal edilmiş belgede de döner (`cancellable=false`, panel nedenini gösterir). */
export async function previewDeliveryNoteCancel(noteId: string): Promise<NoteCancelPreview> {
  return evaluateNoteCancel(prisma, await loadNoteCancelContext(prisma, noteId));
}
