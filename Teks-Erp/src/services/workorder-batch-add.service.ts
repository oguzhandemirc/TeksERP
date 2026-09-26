// =============================================================================
// PARTİ EKLE — açık iş emrine yeni parti (hareket defteri D8, tasarım §6.5; kullanıcı kararı S4)
// =============================================================================
// Stok topunu iş emrine bağlayan TEK boğaz (`addBatchToWorkOrderTx`): okutulan toplar HER ZAMAN
// yeni bir parti olur ve rotanın İLK adımından başlar; mevcut partiye top eklenmez. Tamamlanmış
// iş emrine eklenmez (409 WO_COMPLETED_NO_ADD — yeni iş emri açılır). Tek iş emri tek kumaş:
// kumaş hedeften farklıysa ret. Hedef/renk aşımı UYARIDIR, engel değil.
// Sıra: iş emri satır kilidi İLK ifade → taze durum kapısı → claim → stok defteri (üretime giriş)
// → iç ilk adımda giriş hareketi → parti (8022 numara kilidi) → BÜTÜN adımlar yeniden hesap (R2).
// =============================================================================

import { Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002 } from "../utils/p2002";
import { normalizeScanCode } from "../utils/code-format";
import { AuditService } from "./audit.service";
import { createBatchTx, K18_DEAD_STATUSES } from "./batch.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { postProductionIssuesTx } from "./helpers/production-issue-ledger.helper";
import { ensureWorkOrderInProgress, recomputeStepStatus } from "./helpers/roll-step.helper";
import { recordBatchAddedTx } from "./helpers/workorder-event.helper";
import { STEP_CAPABILITY_SELECT, stepCanApplyColor, stepCanApplyProperty } from "./helpers/step-capability.helper";
import { ACTIVE_ROLL_PROPERTY, ACTIVE_TARGET_PROPERTY } from "./helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK } from "./helpers/order-link.helper";
import { unitLabel } from "../constants/item-unit";

type Tx = Prisma.TransactionClient;

/** Bağlanabilir stok topu — tablet `scanClassify` ve quickStart ile BİREBİR. */
export const ATTACHABLE_ROLL_STATUSES: readonly RollStatus[] = [RollStatus.STOCK, RollStatus.WAREHOUSE, RollStatus.A1_STOCK];

export interface AddBatchInput {
  workOrderId: string;
  barcodes: string[];
  userId?: string;
  clientToken?: string | null;
  /** STRICT: tek ret bütün isteği düşürür (Parti Ekle). LENIENT: ret listesi, kalanlar bağlanır (quickStart). */
  mode: "STRICT" | "LENIENT";
  /** Hareket defterine BATCH_ADDED yazılsın mı (ilk parti açılışın parçasıdır, yazılmaz). */
  recordEvent: boolean;
  reason?: string | null;
}

export interface AddBatchResult {
  attached: { id: string; barcode: string | null; prevStatus: RollStatus; qtyIn: number }[];
  errors: string[];
  batch: { id: string; batchNumber: string } | null;
  firstStepId: string;
  warnings: string[];
}

const WO_ADD_SELECT = {
  id: true, status: true, workOrderNumber: true, targetItemId: true, targetColorId: true, targetQuantity: true,
  targetItem: { select: { unit: true } },
  targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } },
  orderLinks: { where: ACTIVE_ORDER_LINK, select: { allocatedQty: true } },
  steps: {
    select: { id: true, stepSequence: true, station: { select: { type: true, ...STEP_CAPABILITY_SELECT } }, requiredCategory: { select: STEP_CAPABILITY_SELECT } },
    orderBy: { stepSequence: "asc" },
  },
} satisfies Prisma.WorkOrderSelect;
type WoForAdd = Prisma.WorkOrderGetPayload<{ select: typeof WO_ADD_SELECT }>;

/** Tamamlanmış iş emrine top giremez — Parti Ekle, quickStart ve saha düzeltme araçları (Tambur/taşıma) AYNI cevabı verir. */
export const WO_COMPLETED_NO_ADD_MESSAGE = "Tamamlanmış iş emrine top eklenemez — yeni iş emri açın.";
export function completedNoAddError(): AppError {
  return AppError.conflict(WO_COMPLETED_NO_ADD_MESSAGE, { code: "WO_COMPLETED_NO_ADD" });
}

/** Parti eklenebilen durumlar — ALLOWLIST (fail-closed): yeni bir statü doğarsa kapı kapalı doğar. */
const OPEN_FOR_ADD: readonly WorkOrderStatus[] = [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS];

async function loadOpenWorkOrderTx(tx: Tx, workOrderId: string): Promise<WoForAdd> {
  await touchWorkOrderTx(tx, workOrderId);
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: WO_ADD_SELECT });
  if (!wo) throw AppError.notFound("İş emri bulunamadı");
  if (wo.status === WorkOrderStatus.COMPLETED) throw completedNoAddError();
  if (!OPEN_FOR_ADD.includes(wo.status)) {
    throw AppError.conflict(
      `${wo.workOrderNumber} iş emri ${wo.status === WorkOrderStatus.CANCELLED ? "iptal edildi" : "devredildi"} — top bağlanamaz. Listeyi yenileyin.`,
      { code: "WORKORDER_TERMINAL_DURING_ATTACH" },
    );
  }
  if (wo.steps.length === 0) throw AppError.badRequest("İş emrinde rota adımı tanımlanmamış");
  return wo;
}

const ROLL_ADD_SELECT = {
  id: true, barcode: true, status: true, sackId: true, shipmentId: true, itemId: true, colorId: true, currentQty: true, weightKg: true, warehouseId: true,
  properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } },
} satisfies Prisma.RollSelect;
type RollRow = Prisma.RollGetPayload<{ select: typeof ROLL_ADD_SELECT }>;

/** Okutulan barkodlardan bağlanabilirler + ret sebepleri (tek kaynak: tablet sınıflandırıcısıyla aynı kurallar). */
async function classifyRollsTx(tx: Tx, wo: WoForAdd, barcodes: string[]): Promise<{ ok: RollRow[]; rejects: { barcode: string; reason: string }[] }> {
  const rows = await tx.roll.findMany({
    where: { barcode: { in: barcodes } },
    select: ROLL_ADD_SELECT,
  });
  const byBarcode = new Map(rows.map((r) => [r.barcode, r]));
  const ok: RollRow[] = [];
  const rejects: { barcode: string; reason: string }[] = [];
  // Hedef kumaş yoksa iş emrindeki mevcut topların kumaşı, o da yoksa okutulan ilk uygun top.
  const existing = wo.targetItemId ? null
    : await tx.roll.findFirst({ where: { batch: { workOrderId: wo.id } }, select: { itemId: true }, orderBy: { createdAt: "asc" } });
  const itemOf = wo.targetItemId ?? existing?.itemId ?? rows.find((r) => ATTACHABLE_ROLL_STATUSES.includes(r.status))?.itemId ?? null;
  for (const barcode of barcodes) {
    const r = byBarcode.get(barcode);
    const reason = !r ? "Barkod bulunamadı"
      : !ATTACHABLE_ROLL_STATUSES.includes(r.status) ? `Top stokta değil (${r.status})`
      : r.sackId || r.shipmentId ? "Top bir çuvalda/sevkiyatta — önce oradan çıkarın"
      : itemOf && r.itemId !== itemOf ? "Farklı kumaş — tek iş emri tek kumaş"
      : null;
    if (reason || !r) rejects.push({ barcode, reason: reason ?? "Barkod bulunamadı" });
    else ok.push(r);
  }
  return { ok, rejects };
}

async function claimAndEnterTx(tx: Tx, wo: WoForAdd, rolls: RollRow[], userId?: string): Promise<{ claimed: RollRow[]; lost: RollRow[] }> {
  const first = wo.steps[0];
  const res = await tx.roll.updateManyAndReturn({
    where: { id: { in: rolls.map((r) => r.id) }, status: { in: [...ATTACHABLE_ROLL_STATUSES] }, sackId: null, shipmentId: null },
    data: { status: RollStatus.IN_PRODUCTION, producedInStepId: first.id, currentStepId: first.id },
    select: { id: true },
  });
  const ids = new Set(res.map((r) => r.id));
  const claimed = rolls.filter((r) => ids.has(r.id));
  await postProductionIssuesTx(tx, claimed, { workOrderStepId: first.id, userId: userId ?? null });
  if (claimed.length > 0 && first.station.type !== "EXTERNAL") {
    await tx.rollMovement.createMany({
      data: claimed.map((r) => ({ rollId: r.id, workOrderStepId: first.id, qtyIn: r.currentQty, weightIn: r.weightKg, operatorId: userId ?? null })),
    });
  }
  return { claimed, lost: rolls.filter((r) => !ids.has(r.id)) };
}

/**
 * Engel değil UYARI (§6.5 R3): hedef/sipariş aşımı; hedef renkte/özellikte olmayan top + rotada onu
 * verecek adım yok. Kapsama yüklemi rota kapsamasıyla boğaz-ikiz (`stepCanApplyColor/Property`).
 */
async function addWarningsTx(tx: Tx, wo: WoForAdd, claimed: RollRow[]): Promise<string[]> {
  const out: string[] = [];
  const unit = unitLabel(wo.targetItem?.unit);
  const fmt = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ${unit}`;
  const agg = await tx.roll.aggregate({ where: { batch: { workOrderId: wo.id }, status: { notIn: K18_DEAD_STATUSES } }, _sum: { currentQty: true } });
  const total = Number(agg._sum.currentQty ?? 0);
  const target = Number(wo.targetQuantity ?? 0);
  if (target > 0 && total > target) out.push(`Hedef ${fmt(target)}, iş emrindeki toplam ${fmt(total)}.`);
  const ordered = wo.orderLinks.reduce((acc, l) => acc + Number(l.allocatedQty), 0);
  if (ordered > 0 && total > ordered) out.push(`Sipariş tahsisi ${fmt(ordered)}, iş emrindeki toplam ${fmt(total)}.`);
  const colorStep = wo.steps.some((s) => stepCanApplyColor(s.station, s.requiredCategory));
  const offColor = wo.targetColorId && !colorStep ? claimed.filter((r) => r.colorId !== wo.targetColorId).length : 0;
  if (offColor > 0) out.push(`${offColor} top hedef renkte değil ve rotada renk veren adım yok — bu renge boyanmayacak.`);
  const propStep = wo.steps.some((s) => stepCanApplyProperty(s.station, s.requiredCategory));
  const need = wo.targetProperties.map((p) => p.propertyId);
  const offProp = need.length && !propStep ? claimed.filter((r) => need.some((id) => !r.properties.some((p) => p.propertyId === id))).length : 0;
  if (offProp > 0) out.push(`${offProp} topta hedef özellik yok ve rotada özellik veren adım yok.`);
  return out;
}

/** Tek boğaz — çağıran tx'i `withBarcodeRetry` ile sarar (parti numarası yarışı). */
export async function addBatchToWorkOrderTx(tx: Tx, input: AddBatchInput): Promise<AddBatchResult> {
  const wo = await loadOpenWorkOrderTx(tx, input.workOrderId);
  const { ok, rejects } = await classifyRollsTx(tx, wo, input.barcodes);
  if (input.mode === "STRICT" && (rejects.length > 0 || ok.length === 0)) {
    throw AppError.badRequest(rejects.length ? `Parti eklenemedi: ${rejects.map((r) => `${r.barcode} — ${r.reason}`).join("; ")}` : "Top okutulmadı.", {
      code: rejects.some((r) => r.reason.startsWith("Farklı kumaş")) ? "ITEM_MISMATCH" : "BATCH_ADD_REJECTED",
      rejects,
    });
  }
  const { claimed, lost } = ok.length ? await claimAndEnterTx(tx, wo, ok, input.userId) : { claimed: [], lost: [] };
  if (input.mode === "STRICT" && lost.length > 0) throw AppError.conflict("Toplardan biri bu sırada değişti — tekrar deneyin.", { code: "BATCH_ADD_RACE" });
  const errors = [...rejects.map((r) => `${r.barcode}: ${r.reason}`), ...lost.map((r) => `${r.barcode}: Top başka bir işlemde değişti, tekrar deneyin`)];
  if (claimed.length === 0) return { attached: [], errors, batch: null, firstStepId: wo.steps[0].id, warnings: [] };
  const { batch } = await createBatchTx(tx, { workOrderId: wo.id, rollIds: claimed.map((r) => r.id), userId: input.userId, clientToken: input.clientToken });
  for (const s of wo.steps) await recomputeStepStatus(tx, s.id);
  if (wo.steps[0].station.type !== "EXTERNAL") await ensureWorkOrderInProgress(tx, wo.id);
  const totalQty = claimed.reduce((acc, r) => acc + Number(r.currentQty), 0);
  if (input.recordEvent) {
    await recordBatchAddedTx(tx, wo.id, { id: batch.id, batchNumber: batch.batchNumber, rollIds: claimed.map((r) => r.id), totalQty }, { trigger: "BATCH_ADD", userId: input.userId, reason: input.reason ?? null });
  }
  return {
    attached: claimed.map((r) => ({ id: r.id, barcode: r.barcode, prevStatus: r.status, qtyIn: Number(r.currentQty) })),
    errors,
    batch: { id: batch.id, batchNumber: batch.batchNumber },
    firstStepId: wo.steps[0].id,
    warnings: await addWarningsTx(tx, wo, claimed),
  };
}

/** Bağlama izi — audit tx DIŞINDA (proje kuralı); top başına + parti doğuşu. */
export async function auditBatchAdd(workOrderId: string, res: AddBatchResult, userId?: string): Promise<void> {
  await AuditService.logMany(res.attached.map((r) => ({
    userId, action: "UPDATE" as const, tableName: "ROLL", recordId: r.id,
    oldData: { status: r.prevStatus },
    newData: { status: "IN_PRODUCTION", workOrderId, firstStepId: res.firstStepId, barcode: r.barcode, qtyIn: r.qtyIn },
  })));
  if (res.batch) {
    await AuditService.log({
      userId, action: "CREATE", tableName: "BATCH", recordId: res.batch.id,
      newData: { batchNumber: res.batch.batchNumber, workOrderId, rollCount: res.attached.length },
    });
  }
}

type AddBatchResponse = {
  success: boolean;
  data: { batch: { id: string; batchNumber: string } | null; rollCount: number; warnings: string[]; replay: boolean };
  message?: string;
  warnings?: string[];
};

/**
 * Parti ekle replay'i: aynı iş emri + okutulan her top o partide ("eksik top yok"). Küme EŞİTLİĞİ değil: partiye
 * sonradan doğan çocuk toplar eklenir ve meşru tekrarı sahte 409'a düşürürdü. 4. durum: başka partiye birleştirilmiş
 * parti → 409 `BATCH_MERGED` (eskiden "başka toplar" çakışması diyordu).
 */
const batchReplay = (workOrderId: string, barcodes: string[]) =>
  tokenReplay<{ id: string; batchNumber: string; workOrderId: string; mergedIntoId: string | null; rolls: Array<{ barcode: string | null }> }, AddBatchResponse>({
    find: (db, clientToken) =>
      db.batch.findUnique({ where: { clientToken }, select: { id: true, batchNumber: true, workOrderId: true, mergedIntoId: true, rolls: { select: { barcode: true } } } }),
    alive: (b) => {
      if (!b.mergedIntoId) return;
      throw AppError.conflict(`Bu form daha önce kaydedilmiş ama parti (${b.batchNumber}) sonra başka bir partiye BİRLEŞTİRİLMİŞ — aynı gönderim tekrar edilemez. Formu kapatıp yeniden açın.`, { code: "BATCH_MERGED", batchId: b.id });
    },
    identity: (b) => {
      const inBatch = new Set(b.rolls.map((r) => r.barcode));
      return [
        { ad: "workOrderId", mevcut: b.workOrderId, gelen: workOrderId },
        { ad: "missingRolls", mevcut: barcodes.filter((x) => !inBatch.has(x)).join(","), gelen: "" },
      ];
    },
    collision: "Bu istek başka bir iş emri ya da başka toplar için kullanıldı — formu yenileyip yeniden deneyin.",
    respond: (b) => ({ success: true, data: { batch: { id: b.id, batchNumber: b.batchNumber }, rollCount: b.rolls.length, warnings: [], replay: true } }),
  });

/** `POST /work-orders/:id/batches` — Parti Ekle (tablet + panel). R + K′: token iş emri satır kilidinin arkasında okunur. */
export async function addBatch(workOrderId: string, body: { clientToken: string; rollBarcodes: string[]; reason?: string }, userId?: string): Promise<AddBatchResponse> {
  const barcodes = [...new Set(body.rollBarcodes.map(normalizeScanCode).filter(Boolean))];
  const replay = batchReplay(workOrderId, barcodes);
  return replay.run(body.clientToken, async () => {
    const outcome = await withBarcodeRetry(
      () =>
        prisma.$transaction(async (tx) => {
          // K′: iş emri satır kilidi (addBatchToWorkOrderTx'in ilk kilidiyle aynı) — aynı token'lı ikinci deneme burada bekler.
          await touchWorkOrderTx(tx, workOrderId);
          const replayed = await replay.behindLock(tx, body.clientToken);
          if (replayed) return { fresh: false as const, replayed };
          return { fresh: true as const, res: await addBatchToWorkOrderTx(tx, { workOrderId, barcodes, userId, clientToken: body.clientToken, mode: "STRICT", recordEvent: true, reason: body.reason }) };
        }),
      undefined,
      (e) => !isClientTokenP2002(e),
    );
    if (!outcome.fresh) return outcome.replayed;
    const res = outcome.res;
    await auditBatchAdd(workOrderId, res, userId);
    return {
      success: true,
      data: { batch: res.batch, rollCount: res.attached.length, warnings: res.warnings, replay: false },
      message: `${res.batch?.batchNumber} partisi eklendi · ${res.attached.length} top`,
      ...(res.warnings.length ? { warnings: res.warnings } : {}),
    };
  });
}
