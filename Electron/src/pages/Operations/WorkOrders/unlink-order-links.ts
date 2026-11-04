import type { WorkOrder } from "./types";

/**
 * "Sipariş Bağını Kopar" — saf kurallar (diyalog + tuş görünürlüğü buradan okur).
 * İzin backend 2.11.2 `DELETE /work-orders/:id/order-links/:orderLineId` route'unun
 * aynası: `requireAnyPermission("workorder:write", "mobile:is-emri-duzelt")`.
 */
export const UNLINK_ORDER_PERMISSIONS = ["workorder:write", "mobile:is-emri-duzelt"] as const;

type OrderLinks = NonNullable<WorkOrder["orderLinks"]>;
type WoLike = Pick<WorkOrder, "status"> & { orderLinks?: WorkOrder["orderLinks"] };

const CLOSED_STATUSES = new Set(["COMPLETED", "CANCELLED", "SUPERSEDED"]);

/** Tuş görünür mü: aktif bağ var · iş emri kapanmamış · izin var. */
export function canShowUnlinkOrders(
  wo: WoLike | null | undefined,
  hasAnyPermission: (perms: string[]) => boolean,
): boolean {
  if (!wo) return false;
  if ((wo.orderLinks?.length ?? 0) === 0) return false;
  if (CLOSED_STATUSES.has(wo.status)) return false;
  return hasAnyPermission([...UNLINK_ORDER_PERMISSIONS]);
}

export const LAST_LINK_BLOCK_REASON =
  "Son sipariş bağı koparılamaz: iş emrinin hedef kumaşı boş. Önce “Düzenle”den hedef kumaşı seçin.";

export interface UnlinkRowState {
  disabled: boolean;
  reason: string | null;
}

/**
 * Satır başına seçilebilirlik. Hedef kumaş boşken son bağ koparılamaz (backend
 * aynı durumda 400 döner): seçilmemiş TEK satır kaldıysa o satır pasiftir.
 * Seçili satır hiçbir zaman pasif değildir (seçim geri alınabilsin).
 */
export function unlinkRowStates(
  links: OrderLinks,
  selected: ReadonlySet<string>,
  targetItemId: string | null,
): Record<string, UnlinkRowState> {
  const out: Record<string, UnlinkRowState> = {};
  const unselected = links.filter((l) => !selected.has(l.orderLineId));
  const blockLast = !targetItemId && unselected.length === 1;
  for (const l of links) {
    const blocked = blockLast && !selected.has(l.orderLineId);
    out[l.orderLineId] = { disabled: blocked, reason: blocked ? LAST_LINK_BLOCK_REASON : null };
  }
  return out;
}

export interface ColorSuggestion {
  colorId: string;
  colorName: string;
}

/**
 * Koparmadan sonra kalan kalemler TEK renkse ve iş emrinin hedef rengi boşsa o
 * rengi öner. Kalan yoksa, renksiz kalem varsa ya da renkler farklıysa öneri yok.
 */
export function remainingColorSuggestion(
  links: OrderLinks,
  removed: ReadonlySet<string>,
  targetColorId: string | null,
): ColorSuggestion | null {
  if (targetColorId) return null;
  const remaining = links.filter((l) => !removed.has(l.orderLineId));
  if (remaining.length === 0) return null;
  const ids = new Set(remaining.map((l) => l.orderLine?.colorId ?? null));
  if (ids.size !== 1) return null;
  const [colorId] = [...ids];
  if (!colorId) return null;
  // Adı okunamayan renk önerilmez (cümle "<RENK>" boş kalırdı).
  const colorName = remaining.find((l) => l.orderLine?.color?.name)?.orderLine?.color?.name;
  return colorName ? { colorId, colorName } : null;
}
