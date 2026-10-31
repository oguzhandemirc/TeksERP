// =============================================================================
// SİPARİŞ SATIRI ÜRETİM DURUMU — TEK KAYNAK (SY-K2; tasarım §12.5 madde 2, karar K13)
// =============================================================================
// "Sipariş satırı hangi renkte?" sorusunun TEK cevabı. Renk SAKLANMAZ, her okumada türetilir:
//   BEYAZ  (WHITE)  bağlı iş emri / dokuma işi yok
//   SARI   (YELLOW) bağlı iş var ∧ sevke hazır değil
//   YEŞİL  (GREEN)  sevke hazır — `ship-readiness.helper` cevabı (bağlı her canlı iş emri READY);
//                   satırın tamamı sevk edilmiş ya da sipariş kapanmışsa da YEŞİL (sevk edilen hazırdır)
//   KIRMIZI (RED)   termin fabrika gününe göre geçti ∧ YEŞİL değil
// Hazırlık yüklemi BURADA YAZILMAZ (top statüsü okunmaz); `test_order_line_production_state` §AST korur.
// Toplu: satır sayısından bağımsız sabit sorgu sayısı (satırlar + hazırlık toplamı).
// =============================================================================
import { OrderStatus, WeavingOrderStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryYmd } from "../../constants/time";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { effectiveShipReadyPolicy } from "./ship-readiness.helper";
import { computeReadyWorks } from "../ready-works.service";

export type OrderLineProductionState = "WHITE" | "YELLOW" | "GREEN" | "RED";
export const ORDER_LINE_PRODUCTION_STATES: readonly OrderLineProductionState[] = ["WHITE", "YELLOW", "GREEN", "RED"];

/**
 * Termin geçti mi — takvim günüyle (termin günü bitmeden geçmiş sayılmaz). Panel termini "YYYY-MM-DD" →
 * tam UTC gece yarısı saklar: o gün UTC parçalarıdır (`fmtCalendarDate` kuralı); başka an fabrika günündedir.
 */
function deadlinePassed(deadline: Date | null, now: Date): boolean {
  if (deadline === null) return false;
  const day = deadline.getTime() % 86_400_000 === 0 ? deadline.toISOString().slice(0, 10) : factoryYmd(deadline);
  return day < factoryYmd(now);
}

/**
 * Satırların üretim durumu. Bilinmeyen / iptal edilmiş satır haritada YOKTUR (çağıran listeden düşürür).
 * `now` yalnız bekçi içindir; üretimde verilmez.
 */
export async function orderLineProductionState(
  lineIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, OrderLineProductionState>> {
  const out = new Map<string, OrderLineProductionState>();
  if (lineIds.length === 0) return out;
  const lines = await prisma.orderLine.findMany({
    where: { id: { in: [...lineIds] }, cancelledAt: null, order: { status: { not: OrderStatus.CANCELLED } } },
    select: {
      id: true,
      quantity: true,
      shippedQty: true,
      order: { select: { status: true, deadline: true } },
      workOrderLinks: {
        where: { ...ACTIVE_ORDER_LINK, workOrder: { status: { not: WorkOrderStatus.CANCELLED } } },
        select: { workOrderId: true },
      },
      weavingOrderLinks: {
        where: { weavingOrder: { status: { not: WeavingOrderStatus.CANCELLED } } },
        select: { weavingOrderId: true },
      },
    },
  });
  const woIds = [...new Set(lines.flatMap((l) => l.workOrderLinks.map((w) => w.workOrderId)))];
  // Hazırlık tek kaynaktan: iş emri birimi, yalnız bağlı iş emirleri (tek toplu sorgu).
  const readyWo = new Set<string>();
  if (woIds.length > 0) {
    const policy = await effectiveShipReadyPolicy();
    for (const r of await computeReadyWorks("workOrder", policy, woIds)) if (r.state === "READY") readyWo.add(r.id);
  }
  for (const l of lines) {
    const fullyShipped = l.order.status === OrderStatus.COMPLETED || (l.quantity.gt(0) && l.shippedQty.gte(l.quantity));
    const wos = l.workOrderLinks.map((w) => w.workOrderId);
    const ready = fullyShipped || (wos.length > 0 && wos.every((id) => readyWo.has(id)));
    let state: OrderLineProductionState;
    if (ready) state = "GREEN";
    else if (deadlinePassed(l.order.deadline, now)) state = "RED";
    else state = wos.length + l.weavingOrderLinks.length > 0 ? "YELLOW" : "WHITE";
    out.set(l.id, state);
  }
  return out;
}
