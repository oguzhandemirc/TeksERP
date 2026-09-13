// =============================================================================
// DOKUMA İŞİ (WeavingOrder) — YAZMA YÜZEYİ (2026-09-13)
// =============================================================================
// Dokuma işi bir `WorkOrder` DEĞİLDİR: kendi varlığı, kendi yaşam döngüsü
// (PLANNED → IN_PROGRESS → COMPLETED | CANCELLED). Top burada doğmaz (KK1'de
// doğar), sipariş bağı açılmaz, canlı sayaç kolonu yok — `plannedM` bir hedeftir.
//
// ── DEFTERE YAZMAZ ───────────────────────────────────────────────────────────
// Bu tablo bir DURUM tablosudur; koşum/duruş/doff/top kendi defterlerini tutar.
// İptal bir durum geçişidir, ters mekanizma KAPSAM DIŞI (reopen yok) — eksiklik
// değil, kararın kendisi (`docs/kurallar/dokuma.md`).
//
// ── ÜÇ KAPI ──────────────────────────────────────────────────────────────────
// • Numara: `DK`+GGAAYY+NNNN, 8032 kilidi `nextWeavingOrderNumberTx`in İLK ifadesi.
// • Replay: `clientToken` dört durumlu (`assertWeavingOrderReplayAlive`).
// • Kapat/iptal: `status IN (PLANNED, IN_PROGRESS)` üzerinden ATOMİK CLAIM;
//   açık koşum varsa 409 koşumları ADIYLA söyler. `PLANNED → IN_PROGRESS`
//   geçişi BU YÜZEYDE YOK (sözleşme yazılı değil; sahibi P2b koşum-açma ucu).
//
// ⚠️ İKİZ YÜKLEM (P2b'ye not): koşum-açma ucu kendi atomik WHERE'inde dokuma
// işinin `status IN (PLANNED, IN_PROGRESS)` olduğunu şart koşmalı — buradaki
// "açık koşum yok → kapat" kontrolü tek başına TOCTOU penceresi bırakır.
// =============================================================================

import { ItemType, Prisma, WeavingOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { CursorPaginatedResponse } from "./base.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildTextSearch } from "../utils/query-parser";
import { buildNextDynamicCursor, decodeDynamicCursor, dynamicCursorWhere } from "../utils/cursor";
import { AuditService } from "./audit.service";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { assertWeavingOrderReplayAlive } from "./helpers/token-replay.helper";
import { nextWeavingOrderNumberTx } from "./helpers/weaving-order.helper";
import {
  OPEN_RUN_WHERE,
  WEAVING_ORDER_SELECT,
  WEAVING_ORDER_STATUS_LABEL,
  WeavingOrderCreateInput,
  WeavingOrderDto,
  WeavingOrderUpdateInput,
  assertWeavingDateOrder,
  assertWeavingParty,
  normalizeWeavingOrderFields,
  toWeavingOrderDto,
  weavingOrderAuditView,
} from "./helpers/weaving-order-input.helper";

export type { WeavingOrderCreateInput, WeavingOrderDto, WeavingOrderUpdateInput };

/** Audit modül adı — dokuma işinin kendi geçmişi burada okunur. */
const WEAVING_ORDER_TABLE = "WEAVING_ORDER";

/** Düzenlenebilir / kapatılabilir / iptal edilebilir durumlar. */
export const WEAVING_ORDER_OPEN_STATUSES: readonly WeavingOrderStatus[] = [
  WeavingOrderStatus.PLANNED,
  WeavingOrderStatus.IN_PROGRESS,
];

export interface WeavingOrderListParams {
  status?: WeavingOrderStatus[];
  itemId?: string | { in: string[] } | null;
  subcontractorId?: string | null;
  search?: string | null;
  cursor?: string | null;
  limit?: number | null;
  withTotal?: boolean;
}

// ── ② tx-dışı ucuz doğrulama ────────────────────────────────────────────────

/** Referansların varlığı ve türü — FK 500'ü yerine operatör dilinde 400. */
async function assertRefs(f: {
  itemId: string;
  colorId: string | null;
  warpSpecId: string | null;
  subcontractorId: string | null;
}): Promise<void> {
  const item = await prisma.item.findUnique({ where: { id: f.itemId }, select: { itemType: true, isActive: true } });
  if (!item || !item.isActive) throw AppError.badRequest("Kumaş kartı bulunamadı ya da pasif");
  if (item.itemType !== ItemType.FABRIC) throw AppError.badRequest("Dokuma işi yalnız KUMAŞ kartına açılır");
  if (f.colorId) {
    const n = await prisma.color.count({ where: { id: f.colorId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Renk bulunamadı ya da pasif");
  }
  if (f.warpSpecId) {
    const n = await prisma.warpSpec.count({ where: { id: f.warpSpecId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Çözgü kartı bulunamadı ya da pasif");
  }
  if (f.subcontractorId) {
    const n = await prisma.subcontractor.count({ where: { id: f.subcontractorId, isActive: true } });
    if (n === 0) throw AppError.badRequest("Fasoncu bulunamadı ya da pasif");
  }
}

/** Açık koşumları ADIYLA döner — 409 yükü `{code, machines[], runIds[]}`. */
async function assertNoOpenRunsTx(tx: Prisma.TransactionClient, weavingOrderId: string, eylem: string): Promise<void> {
  const open = await tx.machineRun.findMany({
    where: { weavingOrderId, ...OPEN_RUN_WHERE },
    select: { id: true, productionLineNo: true, machine: { select: { code: true, name: true } } },
    orderBy: { startedAt: "asc" },
  });
  if (open.length === 0) return;
  const machines = open.map((r) => ({
    runId: r.id,
    machineCode: r.machine.code,
    machineName: r.machine.name,
    productionLineNo: r.productionLineNo,
  }));
  const adlar = [...new Set(machines.map((m) => m.machineName))].join(", ");
  throw AppError.conflict(
    `Açık koşum varken dokuma işi ${eylem} — önce koşumları kapatın: ${adlar}`,
    { code: "WEAVING_ORDER_HAS_OPEN_RUNS", machines, runIds: open.map((r) => r.id) },
  );
}

/** Claim düştü → taze oku: yok → 404, var → 409 (durum adıyla). */
async function throwClaimFailureTx(tx: Prisma.TransactionClient, id: string, eylem: string, code: string): Promise<never> {
  const fresh = await tx.weavingOrder.findUnique({ where: { id }, select: { status: true, weavingOrderNumber: true } });
  if (!fresh) throw AppError.notFound("Dokuma işi bulunamadı");
  throw AppError.conflict(
    `${fresh.weavingOrderNumber} ${WEAVING_ORDER_STATUS_LABEL[fresh.status]} — ${eylem}`,
    { code, status: fresh.status },
  );
}

// ── Okuma ──────────────────────────────────────────────────────────────────

export async function getWeavingOrder(id: string): Promise<ApiResponse<WeavingOrderDto>> {
  const row = await prisma.weavingOrder.findUnique({ where: { id }, select: WEAVING_ORDER_SELECT });
  if (!row) throw AppError.notFound("Dokuma işi bulunamadı");
  return { success: true, data: toWeavingOrderDto(row) };
}

/** Cursor'lu liste — süzme SUNUCUDA, en yeni önce. Özet (`totalEstimate`) aynı where'den. */
export async function listWeavingOrders(
  params: WeavingOrderListParams,
): Promise<CursorPaginatedResponse<WeavingOrderDto>> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
  const where: Prisma.WeavingOrderWhereInput = {};
  if (params.status && params.status.length > 0) where.status = { in: params.status };
  if (params.itemId) where.itemId = params.itemId;
  if (params.subcontractorId) where.subcontractorId = params.subcontractorId;
  const term = params.search?.trim();
  if (term) {
    where.OR = buildTextSearch<Prisma.WeavingOrderWhereInput>(term, {
      text: ["item.name", "subcontractor.name"],
      code: ["weavingOrderNumber"],
    });
  }
  const cur = decodeDynamicCursor(params.cursor ?? undefined);
  const pageWhere = cur ? { AND: [where, dynamicCursorWhere(cur, "createdAt", "desc")] } : where;
  const rows = await prisma.weavingOrder.findMany({
    where: pageWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: WEAVING_ORDER_SELECT,
  });
  const totalEstimate = params.withTotal ? await prisma.weavingOrder.count({ where }) : undefined;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1] as Record<string, unknown> | undefined;
  return {
    success: true,
    data: page.map(toWeavingOrderDto),
    pagination: {
      nextCursor: hasMore ? buildNextDynamicCursor(last, "createdAt") : null,
      hasMore,
      limit,
      ...(totalEstimate !== undefined ? { totalEstimate } : {}),
    },
  };
}

// ── Yazma ──────────────────────────────────────────────────────────────────

export async function createWeavingOrder(
  input: WeavingOrderCreateInput,
  userId?: string,
): Promise<ApiResponse<WeavingOrderDto>> {
  const f = normalizeWeavingOrderFields(input);
  const fields = {
    itemId: input.itemId,
    colorId: f.colorId ?? null,
    warpSpecId: f.warpSpecId ?? null,
    plannedM: f.plannedM ?? null,
    executionKind: input.executionKind,
    subcontractorId: f.subcontractorId ?? null,
    plannedStartDate: f.plannedStartDate ?? null,
    plannedEndDate: f.plannedEndDate ?? null,
    notes: f.notes ?? null,
  };
  assertWeavingParty(fields.executionKind, fields.subcontractorId);
  assertWeavingDateOrder(fields.plannedStartDate, fields.plannedEndDate);

  if (input.clientToken) {
    const replay = await prisma.weavingOrder.findUnique({
      where: { clientToken: input.clientToken },
      select: WEAVING_ORDER_SELECT,
    });
    if (replay) {
      // Gövde kapısı: aynı token BAŞKA bir yükle gelirse cached kayıt yanlış cevaptır.
      assertReplayPayloadMatches(
        [
          { ad: "itemId", mevcut: replay.itemId, gelen: fields.itemId },
          { ad: "executionKind", mevcut: replay.executionKind, gelen: fields.executionKind },
          { ad: "subcontractorId", mevcut: replay.subcontractorId, gelen: fields.subcontractorId },
          { ad: "plannedM", mevcut: replay.plannedM, gelen: fields.plannedM },
        ],
        "Bu istemci anahtarı BAŞKA bir dokuma işiyle kullanılmış — formu yenileyip yeniden deneyin.",
      );
      assertWeavingOrderReplayAlive(replay);
      return { success: true, data: toWeavingOrderDto(replay), message: "Dokuma işi zaten oluşturulmuş" };
    }
  }

  await assertRefs(fields);

  const created = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // Kilit üretecin ilk ifadesi; bundan önce tx'te başka ifade YOK.
        const weavingOrderNumber = await nextWeavingOrderNumberTx(tx, new Date());
        return tx.weavingOrder.create({
          data: {
            ...fields,
            weavingOrderNumber,
            status: WeavingOrderStatus.PLANNED,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
            updatedById: userId ?? null,
          },
          select: WEAVING_ORDER_SELECT,
        });
      }),
    undefined,
    // Yalnız numara çakışması retry'a girer; `clientToken` çakışması kalıcıdır.
    (err) => Array.isArray(err.meta?.target) && (err.meta.target as string[]).includes("weavingOrderNumber"),
  );

  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: WEAVING_ORDER_TABLE,
    recordId: created.id,
    newData: weavingOrderAuditView(created),
  });
  return { success: true, data: toWeavingOrderDto(created), message: `${created.weavingOrderNumber} oluşturuldu` };
}

/**
 * Planlama alanlarını günceller — yalnız AÇIK durumda (kapanmış/iptal edilmiş
 * iş salt-okunurdur, `PLAN_CHANGE_FROZEN_STATUSES` emsali). Durum BURADAN
 * değişmez; kapat/iptal kendi uçlarıdır.
 */
export async function updateWeavingOrder(
  id: string,
  input: WeavingOrderUpdateInput,
  userId?: string,
): Promise<ApiResponse<WeavingOrderDto>> {
  const patch = normalizeWeavingOrderFields(input);
  if (Object.keys(patch).length === 0) throw AppError.badRequest("Güncellenecek alan yok");

  const before = await prisma.weavingOrder.findUnique({ where: { id }, select: WEAVING_ORDER_SELECT });
  if (!before) throw AppError.notFound("Dokuma işi bulunamadı");

  const merged = {
    itemId: patch.itemId ?? before.itemId,
    colorId: patch.colorId !== undefined ? patch.colorId : before.colorId,
    warpSpecId: patch.warpSpecId !== undefined ? patch.warpSpecId : before.warpSpecId,
    executionKind: patch.executionKind ?? before.executionKind,
    subcontractorId: patch.subcontractorId !== undefined ? patch.subcontractorId : before.subcontractorId,
    plannedStartDate: patch.plannedStartDate !== undefined ? patch.plannedStartDate : before.plannedStartDate,
    plannedEndDate: patch.plannedEndDate !== undefined ? patch.plannedEndDate : before.plannedEndDate,
  };
  assertWeavingParty(merged.executionKind, merged.subcontractorId);
  assertWeavingDateOrder(merged.plannedStartDate, merged.plannedEndDate);
  await assertRefs(merged);

  const updated = await prisma.$transaction(async (tx) => {
    const claim = await tx.weavingOrder.updateMany({
      where: { id, status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } },
      data: { ...patch, updatedById: userId ?? null },
    });
    if (claim.count === 0) await throwClaimFailureTx(tx, id, "düzenlenemez", "WEAVING_ORDER_NOT_EDITABLE");
    return tx.weavingOrder.findUniqueOrThrow({ where: { id }, select: WEAVING_ORDER_SELECT });
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: WEAVING_ORDER_TABLE,
    recordId: id,
    oldData: weavingOrderAuditView(before),
    newData: weavingOrderAuditView(updated),
  });
  return { success: true, data: toWeavingOrderDto(updated), message: `${updated.weavingOrderNumber} güncellendi` };
}

/**
 * Kapanış AÇIK BİR KARARDIR — türetilmez. Açık koşum varken 409 (koşumlar
 * adıyla). `plannedM`e ulaşmak bu ucu ÇAĞIRMAZ.
 */
export async function closeWeavingOrder(id: string, userId?: string): Promise<ApiResponse<WeavingOrderDto>> {
  const before = await prisma.weavingOrder.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw AppError.notFound("Dokuma işi bulunamadı");

  const closed = await prisma.$transaction(async (tx) => {
    await assertNoOpenRunsTx(tx, id, "kapatılamaz");
    const claim = await tx.weavingOrder.updateMany({
      where: { id, status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } },
      data: {
        status: WeavingOrderStatus.COMPLETED,
        closedAt: new Date(),
        closedById: userId ?? null,
        updatedById: userId ?? null,
      },
    });
    if (claim.count === 0) await throwClaimFailureTx(tx, id, "kapatılamaz", "WEAVING_ORDER_NOT_OPEN");
    return tx.weavingOrder.findUniqueOrThrow({ where: { id }, select: WEAVING_ORDER_SELECT });
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: WEAVING_ORDER_TABLE,
    recordId: id,
    changes: [{ field: "status", old: before.status, new: closed.status }],
  });
  return { success: true, data: toWeavingOrderDto(closed), message: `${closed.weavingOrderNumber} kapatıldı` };
}

/**
 * İptal yalnız bu satır üstünde bir DURUM GEÇİŞİDİR: kapanmış koşum, duruş,
 * doff ve doğmuş top DOKUNULMAZ. Açık koşum varken 409 — önce koşum kapanır.
 * Sebep serbest metin, zorunlu (kataloğa bağlanmadı — borç, kapanma koşulu
 * `docs/kurallar/dokuma.md`).
 */
export async function cancelWeavingOrder(
  id: string,
  reason: string,
  userId?: string,
): Promise<ApiResponse<WeavingOrderDto>> {
  const cancelReason = reason.trim().slice(0, 300);
  if (!cancelReason) throw AppError.badRequest("İptal sebebi zorunlu");
  const before = await prisma.weavingOrder.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw AppError.notFound("Dokuma işi bulunamadı");

  const cancelled = await prisma.$transaction(async (tx) => {
    await assertNoOpenRunsTx(tx, id, "iptal edilemez");
    const claim = await tx.weavingOrder.updateMany({
      where: { id, status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } },
      data: {
        status: WeavingOrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId ?? null,
        cancelReason,
        updatedById: userId ?? null,
      },
    });
    if (claim.count === 0) await throwClaimFailureTx(tx, id, "iptal edilemez", "WEAVING_ORDER_NOT_OPEN");
    return tx.weavingOrder.findUniqueOrThrow({ where: { id }, select: WEAVING_ORDER_SELECT });
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: WEAVING_ORDER_TABLE,
    recordId: id,
    changes: [
      { field: "status", old: before.status, new: cancelled.status },
      { field: "cancelReason", old: null, new: cancelReason },
    ],
  });
  return { success: true, data: toWeavingOrderDto(cancelled), message: `${cancelled.weavingOrderNumber} iptal edildi` };
}
