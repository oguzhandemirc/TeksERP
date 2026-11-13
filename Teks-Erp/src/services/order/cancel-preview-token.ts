// =============================================================================
// Sipariş iptali — "gördüğüm önizleme hâlâ geçerli mi" (V4c, patron telefonu)
// =============================================================================
// `GET /orders/:id/cancel-preview` yanıtı `previewToken` taşır; `POST /orders/:id/cancel` gövdesindeki opsiyonel
// `expectedPreviewToken` tutmazsa 409 `CANCEL_PREVIEW_STALE` ve HİÇBİR şey uygulanmaz. Token sır değil, belirlenimli
// özettir: hem önizleme hem uygulama AYNI okuyucu (`readCancelPreviewState`) + AYNI saf fonksiyondan (`cancelPreviewToken`).
// =============================================================================

import { createHash } from "node:crypto";
import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { orderContentUpdatedAt } from "../helpers/stale-record.helper";

/** Token girdisi: sipariş içerik sürümü + etkilenen iş emirleri (durum, tek-sipariş mi) + aktif sevkiyatlar. */
export interface CancelPreviewState {
  orderId: string;
  contentVersion: string;
  workOrders: ReadonlyArray<{ id: string; status: string; isSoleOrder: boolean }>;
  shipments: ReadonlyArray<{ id: string; status: string }>;
}

/** TEK SAF KAYNAK. `exclude`: uygulamanın tx'ten önce kendisi iptal ettiği iş emirleri (iki tarafta da düşülür). */
export function cancelPreviewToken(s: CancelPreviewState, exclude: ReadonlySet<string> = new Set()): string {
  const wos = s.workOrders.filter((w) => !exclude.has(w.id)).map((w) => [w.id, w.status, w.isSoleOrder] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const shs = s.shipments.map((x) => [x.id, x.status] as const).sort((a, b) => a[0].localeCompare(b[0]));
  return `cp1.${createHash("sha256").update(JSON.stringify([s.orderId, s.contentVersion, wos, shs])).digest("hex").slice(0, 32)}`;
}

/** İçerik sürümü = başlık + kalemlerin en büyük `updatedAt`i (`contentUpdatedAt` ile aynı tanım). */
async function readContentVersion(db: Prisma.TransactionClient, orderId: string): Promise<Date | null> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { updatedAt: true, lines: { select: { updatedAt: true } } } });
  return o ? orderContentUpdatedAt(o) : null;
}

/** Önizlemenin gördüğü durum — `prisma` ile önizlemede, tx ile uygulamada (kilitlerden sonra). `version` verilirse okunmaz. */
export async function readCancelPreviewState(db: Prisma.TransactionClient, orderId: string, version?: Date): Promise<CancelPreviewState | null> {
  const v = version ?? (await readContentVersion(db, orderId));
  if (!v) return null;
  const links = await db.workOrderToOrderLine.findMany({
    where: { ...ACTIVE_ORDER_LINK, orderLine: { orderId } },
    select: { workOrder: { select: { id: true, status: true } } },
  });
  const wos = new Map(links.map((l) => [l.workOrder.id, l.workOrder.status as string]));
  const others = wos.size === 0 ? [] : await db.workOrderToOrderLine.findMany({
    where: { ...ACTIVE_ORDER_LINK, workOrderId: { in: [...wos.keys()] }, orderLine: { orderId: { not: orderId } } },
    select: { workOrderId: true },
  });
  const shared = new Set(others.map((o) => o.workOrderId));
  // Aktif sevkiyat = PLANNED bağ (`getActiveShipmentLinks` tanımı).
  const ships = await db.shipmentOrder.findMany({ where: { orderId, shipment: { status: ShipmentStatus.PLANNED } }, select: { shipment: { select: { id: true, status: true } } } });
  return {
    orderId,
    contentVersion: v.toISOString(),
    workOrders: [...wos].map(([id, status]) => ({ id, status, isSoleOrder: !shared.has(id) })),
    shipments: ships.map((s) => ({ id: s.shipment.id, status: s.shipment.status })),
  };
}

/** Önizleme yanıtına eklenecek token (kayıt yoksa null — önizleme zaten 404 verir). */
export async function previewTokenFor(orderId: string): Promise<string | null> {
  const s = await readCancelPreviewState(prisma, orderId);
  return s ? cancelPreviewToken(s) : null;
}

function staleError(): AppError {
  return AppError.conflict("Sipariş siz bakarken değişti. Önizlemeyi yenileyin.", { code: "CANCEL_PREVIEW_STALE" });
}

export interface CancelPreviewGuard {
  /** Tx'in İLK ifadesi (claim'den önce): başlığı claim'in kilidiyle kilitler, sürümü claim ilerletmeden okur. */
  lockTx(tx: Prisma.TransactionClient): Promise<void>;
  /** İş emri kilitlerinden SONRA: taze durum, uygulamanın başta doğruladığı önizlemeyle aynı mı. */
  verifyTx(tx: Prisma.TransactionClient, selfCancelledWoIds: readonly string[]): Promise<void>;
}

const NOOP: CancelPreviewGuard = { lockTx: async () => undefined, verifyTx: async () => undefined };

/**
 * Uygulamanın ilk adımı (iş emri iptalinden ÖNCE): token tutmuyorsa 409, hiçbir şey uygulanmaz. Token yoksa no-op
 * (bugünkü davranış). Dönen bekçi tx içinde aynı kıyası kilitler altında yineler.
 */
export async function guardCancelPreview(orderId: string, expected: string | null | undefined): Promise<CancelPreviewGuard> {
  if (!expected) return NOOP;
  const seen = await readCancelPreviewState(prisma, orderId);
  if (!seen || cancelPreviewToken(seen) !== expected) throw staleError();
  let lockedVersion: Date | null = null;
  return {
    async lockTx(tx) {
      // Derinlik savunması (ES-09): asıl serileştirici sonraki koşullu claim'dir; tx dışında çağırmak koruma sağlamaz.
      // Kilit modu claim'inkiyle aynı (`FOR NO KEY UPDATE`) — yeni kilit gücü/sırası eklemez.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR NO KEY UPDATE`;
      lockedVersion = await readContentVersion(tx, orderId);
    },
    async verifyTx(tx, selfCancelledWoIds) {
      if (!lockedVersion) throw staleError();
      const fresh = await readCancelPreviewState(tx, orderId, lockedVersion);
      const skip = new Set(selfCancelledWoIds);
      if (!fresh || cancelPreviewToken(fresh, skip) !== cancelPreviewToken(seen, skip)) throw staleError();
    },
  };
}
