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
//   açık koşum varsa 409 koşumları ADIYLA söyler. Claim ÖNCE, koşum sayımı SONRA
//   (aynı tx): claim satır kilidi alır ve koşum-açmanın `markWeavingOrderInProgressTx`
//   claim'iyle serileşir — iki tx birbirini görür. `PLANNED → IN_PROGRESS`in tek
//   yazarı o helper, tetikleyicisi koşum-açma; manuel `start` ucu YOK (1e 2026-09-13).
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
import { markWeavingOrderInProgressTx, nextWeavingOrderNumberTx } from "./helpers/weaving-order.helper";
import { assertOrderLinesLinkableTx, normalizeOrderLineLinks, type NormalizedOrderLineLink } from "./helpers/weaving-order-links.helper";
import { assertOrderLineLinkGate } from "./helpers/production-chain-gates.helper";
import { assertNoOpenRunsTx, assertRefs, throwClaimFailureTx } from "./helpers/weaving-order-guards.helper";
import { countRollsOfWeavingOrder } from "./helpers/weaving-order-of-roll.helper";
import { itemDefaultWarpSpecId } from "./helpers/tablet-prefill.helper";
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
import { p2002OnField } from "../utils/p2002";import { assertItemUsableTx } from "./helpers/item-usage.helper";


export type { WeavingOrderCreateInput, WeavingOrderDto, WeavingOrderUpdateInput };
// Koşum-açma ucu (machine-run.service) `IN_PROGRESS` geçişini buradan çağırır — tek yazar.
export { markWeavingOrderInProgressTx };

/** Audit modül adı — dokuma işinin kendi geçmişi burada okunur. */
const WEAVING_ORDER_TABLE = "WEAVING_ORDER";

/** Z1 ③b replace: mevcut bağ kümesi silinir, yenisi yazılır (aynı tx). Pivot audit'i EBEVEYN eylemde
 *  (`weavingOrderAuditView.orderLines`), o yüzden yazıcı bu (audit'li) dosyada durur. */
async function replaceOrderLineLinksTx(tx: Prisma.TransactionClient, weavingOrderId: string, links: NormalizedOrderLineLink[]): Promise<void> {
  await tx.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId } });
  if (links.length > 0) {
    await tx.weavingOrderToOrderLine.createMany({ data: links.map((l) => ({ weavingOrderId, orderLineId: l.orderLineId, allocatedM: l.allocatedM })) });
  }
}

/** Düzenlenebilir / kapatılabilir / iptal edilebilir durumlar. */
export const WEAVING_ORDER_OPEN_STATUSES: readonly WeavingOrderStatus[] = [
  WeavingOrderStatus.PLANNED,
  WeavingOrderStatus.IN_PROGRESS,
];

export interface WeavingOrderListParams {
  status?: WeavingOrderStatus[];
  itemId?: string | { in: string[] } | null;
  subcontractorId?: string | null;
  /** Z1: bu sipariş satırına / bu siparişin herhangi bir satırına bağlı işler (pivot üzerinden). */
  orderLineId?: string | null;
  orderId?: string | null;
  search?: string | null;
  cursor?: string | null;
  limit?: number | null;
  withTotal?: boolean;
}

// ── ② tx-dışı ucuz doğrulama ────────────────────────────────────────────────

export async function getWeavingOrder(id: string): Promise<ApiResponse<WeavingOrderDto>> {
  const row = await prisma.weavingOrder.findUnique({ where: { id }, select: WEAVING_ORDER_SELECT });
  if (!row) throw AppError.notFound("Dokuma işi bulunamadı");
  // Y3 TÜRETİLMİŞ: top → indirme → koşum → iş (kolon yok; zincir TEK dosyada — `weaving-order-of-roll.helper`). Yalnız detayda.
  const producedRollCount = await countRollsOfWeavingOrder(prisma, id);
  return { success: true, data: { ...toWeavingOrderDto(row), producedRollCount } };
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
  if (params.orderLineId) where.orderLineLinks = { some: { orderLineId: params.orderLineId } };
  else if (params.orderId) where.orderLineLinks = { some: { orderLine: { orderId: params.orderId } } };
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
    // E4 (ön-dolum): çözgü kartı verilmezse kumaş kartının varsayılanı (`Item.warpSpecId`); `null` açıkça "kartsız".
    colorId: f.colorId ?? null, warpSpecId: f.warpSpecId ?? (input.warpSpecId === undefined ? await itemDefaultWarpSpecId(prisma, input.itemId) : null),
    plannedM: f.plannedM ?? null,
    executionKind: input.executionKind,
    subcontractorId: f.subcontractorId ?? null,
    plannedStartDate: f.plannedStartDate ?? null,
    plannedEndDate: f.plannedEndDate ?? null,
    notes: f.notes ?? null,
  };
  assertWeavingParty(fields.executionKind, fields.subcontractorId);
  assertWeavingDateOrder(fields.plannedStartDate, fields.plannedEndDate);
  // Z1 (Y1): sipariş satırı bağları — gövde vermezse boş küme (eski istemci: stoka dokuma, bugünkü davranış).
  const orderLines = normalizeOrderLineLinks(input.orderLines ?? []);
  await assertOrderLineLinkGate(prisma, orderLines.length);

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
  await assertOrderLinesLinkableTx(prisma, orderLines);

  const created = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        // Kilit üretecin ilk ifadesi; bundan önce tx'te başka ifade YOK.
        const weavingOrderNumber = await nextWeavingOrderNumberTx(tx, new Date());
        // Kart kilidi advisory'den (8032) SONRA: 8030 SHARED → FOR SHARE (dokuma işi D1 referansıdır).
        await assertItemUsableTx(tx, fields.itemId, "NEW_PLAN");
        const row = await tx.weavingOrder.create({
          data: {
            ...fields,
            weavingOrderNumber,
            status: WeavingOrderStatus.PLANNED,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
            updatedById: userId ?? null,
          },
          select: { id: true },
        });
        await replaceOrderLineLinksTx(tx, row.id, orderLines);
        return tx.weavingOrder.findUniqueOrThrow({ where: { id: row.id }, select: WEAVING_ORDER_SELECT });
      }),
    undefined,
    // Yalnız numara çakışması retry'a girer; `clientToken` çakışması kalıcıdır.
    (err) => p2002OnField(err, "weavingOrderNumber"),
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
  // Z1 (Y1): `orderLines` verildiyse küme replace (③b); verilmediyse bağlara dokunulmaz.
  const orderLines = input.orderLines !== undefined ? normalizeOrderLineLinks(input.orderLines) : null;
  if (Object.keys(patch).length === 0 && orderLines === null) throw AppError.badRequest("Güncellenecek alan yok");

  const before = await prisma.weavingOrder.findUnique({ where: { id }, select: WEAVING_ORDER_SELECT });
  if (!before) throw AppError.notFound("Dokuma işi bulunamadı");
  if (orderLines !== null) {
    await assertOrderLineLinkGate(prisma, orderLines.length);
    await assertOrderLinesLinkableTx(prisma, orderLines);
  }

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
  const retarget = merged.itemId !== before.itemId;
  await assertRefs(merged, retarget ? "NEW_PLAN" : null);

  const updated = await prisma.$transaction(async (tx) => {
    // İLK ifade (dokuma işi satır claim'inden ÖNCE — birleştirme 8030 EXCL tutup o satırı ister).
    if (retarget) await assertItemUsableTx(tx, merged.itemId, "NEW_PLAN");
    const claim = await tx.weavingOrder.updateMany({
      where: { id, status: { in: [...WEAVING_ORDER_OPEN_STATUSES] } },
      data: { ...patch, updatedById: userId ?? null },
    });
    if (claim.count === 0) await throwClaimFailureTx(tx, id, "düzenlenemez", "WEAVING_ORDER_NOT_EDITABLE");
    if (orderLines !== null) await replaceOrderLineLinksTx(tx, id, orderLines);
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
    // CLAIM ÖNCE (satır kilidi), koşum sayımı SONRA — ikiz yüklem.
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
    await assertNoOpenRunsTx(tx, id, "kapatılamaz");
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
    // CLAIM ÖNCE (satır kilidi), koşum sayımı SONRA — ikiz yüklem.
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
    await assertNoOpenRunsTx(tx, id, "iptal edilemez");
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
