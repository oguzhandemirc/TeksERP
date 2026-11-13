// =============================================================================
// Kalem iptali — "gördüğüm önizleme hâlâ geçerli mi" (patron telefonu, sipariş iptali V4c'nin kalem ikizi)
// =============================================================================
// `GET …/lines/:lineId/cancel-preview` yanıtı `previewToken` taşır; `POST …/lines/:lineId/cancel` gövdesindeki isteğe
// bağlı `expectedPreviewToken` tutmazsa 409 `CANCEL_PREVIEW_STALE`, HİÇBİR şey uygulanmaz. Sürüm tek başına yetmez:
// iş emri bağı kalemin `updatedAt`ini ilerletmez, önizlemede görülmemiş bir bağ sessizce koparılırdı.
// =============================================================================

import { createHash } from "node:crypto";
import { Prisma, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import { orderContentUpdatedAt } from "../helpers/stale-record.helper";

/** Token girdisi: sipariş içerik sürümü + kalemin canlı iş emri bağları (durum, stoğa dönecek mi). */
export interface LineCancelState {
  orderId: string;
  lineId: string;
  contentVersion: string;
  workOrders: ReadonlyArray<{ id: string; status: string; willBecomeStock: boolean }>;
}

/** TEK SAF KAYNAK — önizleme ve uygulama aynı fonksiyondan. */
export function lineCancelToken(s: LineCancelState): string {
  const wos = s.workOrders.map((w) => [w.id, w.status, w.willBecomeStock] as const).sort((a, b) => a[0].localeCompare(b[0]));
  return `lc1.${createHash("sha256").update(JSON.stringify([s.orderId, s.lineId, s.contentVersion, wos])).digest("hex").slice(0, 32)}`;
}

/** Önizlemenin gördüğü durum — `prisma` ile önizlemede, tx ile uygulamada (kilitlerden sonra). Kalem yoksa null. */
export async function readLineCancelState(db: Prisma.TransactionClient, orderId: string, lineId: string): Promise<LineCancelState | null> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: { updatedAt: true, lines: { select: { id: true, updatedAt: true } } } });
  if (!o || !o.lines.some((l) => l.id === lineId)) return null;
  const links = await db.workOrderToOrderLine.findMany({
    where: { ...ACTIVE_ORDER_LINK, orderLineId: lineId },
    select: { workOrder: { select: { id: true, status: true, type: true, _count: { select: { orderLinks: { where: ACTIVE_ORDER_LINK } } } } } },
  });
  // Önizlemeyle aynı süzgeç: ölü iş emri (CANCELLED/SUPERSEDED) etkilenmez.
  const live = links.map((l) => l.workOrder).filter((w) => w.status !== WorkOrderStatus.CANCELLED && w.status !== WorkOrderStatus.SUPERSEDED);
  return {
    orderId,
    lineId,
    contentVersion: orderContentUpdatedAt(o).toISOString(),
    workOrders: live.map((w) => ({ id: w.id, status: w.status, willBecomeStock: w.type === WorkOrderType.ORDER_PRODUCTION && w._count.orderLinks === 1 })),
  };
}

/** Önizleme yanıtına eklenecek token (kalem yoksa null — önizleme zaten 404 verir). */
export async function lineCancelTokenFor(orderId: string, lineId: string): Promise<string | null> {
  const s = await readLineCancelState(prisma, orderId, lineId);
  return s ? lineCancelToken(s) : null;
}

function staleError(): AppError {
  return AppError.conflict("Kalem siz bakarken değişti. Önizlemeyi yenileyin.", { code: "CANCEL_PREVIEW_STALE" });
}

/** Tx içi bekçi: verilmediyse no-op (bugünkü davranış). */
export type LineCancelGuard = (tx: Prisma.TransactionClient) => Promise<void>;

/**
 * Uygulamanın ilk adımı: token tutmuyorsa 409, hiçbir şey başlamaz. Dönen bekçi tx'in İLK ifadesidir: siparişin
 * kalemlerini id sırasıyla `FOR UPDATE` (yeni iş emri bağının FK'si bekler) sonra başlığı kilitler — `claimOrderVersionTx`
 * ile aynı sıra — ve taze durumdan token'ı yeniden hesaplar.
 */
export async function guardLineCancelPreview(orderId: string, lineId: string, expected: string | null | undefined): Promise<LineCancelGuard> {
  if (!expected) return async () => undefined;
  const seen = await readLineCancelState(prisma, orderId, lineId);
  if (!seen || lineCancelToken(seen) !== expected) throw staleError();
  return async (tx) => {
    // aktif-kalem-muaf: satır KİLİDİ (FOR UPDATE), talep sorgusu değil — sürüm iptal edilmiş kalemi de kapsar.
    await tx.$queryRaw`SELECT id FROM order_lines WHERE "orderId" = ${orderId}::uuid ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR NO KEY UPDATE`;
    const fresh = await readLineCancelState(tx, orderId, lineId);
    if (!fresh || lineCancelToken(fresh) !== expected) throw staleError();
  };
}
