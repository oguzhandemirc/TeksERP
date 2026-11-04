// "Sipariş Bağını Kopar" — saf (JSX'siz) kurallar: tuş görünürlüğü, diyalog satırları,
// son-bağ kilidi ve koparma sonrası tek-renk önerisi. Başlık ve yan panel AYNI yüklemi okur.
import { matchesPermission } from "@/types/auth";
import type { WorkOrder } from "./types";

/** Backend `DELETE /work-orders/:id/order-links/:orderLineId` → `requireAnyPermission` ile AYNI liste. */
export const UNLINK_ORDER_PERMISSIONS = ["workorder:write", "mobile:is-emri-duzelt"] as const;

type WoForUnlink = Pick<WorkOrder, "status" | "type" | "targetItemId" | "targetColorId" | "orderLinks">;

/** Tuş görünür mü: en az bir aktif bağ + açık iş emri + izin (kapalı statüler bitmiş/iptal/devredilmiş). */
export function canUnlinkOrder(wo: WoForUnlink | null | undefined, permissions: readonly string[]): boolean {
  if (!wo || (wo.orderLinks?.length ?? 0) === 0) return false;
  if (wo.status === "COMPLETED" || wo.status === "CANCELLED" || wo.status === "SUPERSEDED") return false;
  return UNLINK_ORDER_PERMISSIONS.some((p) => matchesPermission(permissions, p));
}

export interface UnlinkRow {
  orderLineId: string;
  orderNumber: string;
  customerName: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  quantity: number | null;
  unit: string | null;
}

/** Diyaloğun listesi — iş emrinin aktif bağları (findById yalnız `unlinkedAt: null` döner). */
export function unlinkRows(wo: Pick<WorkOrder, "orderLinks">): UnlinkRow[] {
  return (wo.orderLinks ?? []).map((l) => ({
    orderLineId: l.orderLineId,
    orderNumber: l.orderLine?.order?.orderNumber ?? "—",
    customerName: l.orderLine?.order?.customer?.name ?? "—",
    itemName: l.orderLine?.item?.name ?? "—",
    colorId: l.orderLine?.colorId ?? null,
    colorName: l.orderLine?.color?.name ?? null,
    quantity: l.orderLine?.quantity != null ? Number(l.orderLine.quantity) : null,
    unit: l.orderLine?.unit ?? null,
  }));
}

/**
 * Backend aynası (`workorder-link.service.unlinkOrderLine`): siparişe özel iş emrinin SON bağı
 * kalkınca iş emri stoğa döner; bunun için hedef kumaş dolu olmalı. Boşsa en az bir bağ kalmalı.
 */
export function lastLinkLocked(wo: Pick<WorkOrder, "type" | "targetItemId">): boolean {
  return wo.type === "ORDER_PRODUCTION" && !wo.targetItemId;
}

export const LAST_LINK_REASON =
  "Hedef kumaş boşken son sipariş bağı koparılamaz — önce 'Düzenle'den hedef kumaşı seçin.";

/** Satır pasif mi: kilitliyken seçilmemiş satır, seçimle bağ sayısı 1'e inecekse seçilemez. */
export function isRowLocked(
  orderLineId: string,
  selected: ReadonlySet<string>,
  total: number,
  locked: boolean,
): boolean {
  return locked && !selected.has(orderLineId) && selected.size >= total - 1;
}

/**
 * Koparma sonrası öneri: hedef renk boşken kalan aktif kalemlerin HEPSİ aynı renkteyse o renk.
 * Kalan yoksa ya da renksiz/karışık kalem varsa null.
 */
export function remainingSingleColor(
  wo: Pick<WorkOrder, "targetColorId" | "orderLinks">,
  removedIds: ReadonlySet<string>,
): { id: string; name: string } | null {
  if (wo.targetColorId) return null;
  const remaining = unlinkRows(wo).filter((r) => !removedIds.has(r.orderLineId));
  if (remaining.length === 0) return null;
  const first = remaining[0];
  if (!first?.colorId) return null;
  if (!remaining.every((r) => r.colorId === first.colorId)) return null;
  return { id: first.colorId, name: first.colorName ?? "seçili renk" };
}
