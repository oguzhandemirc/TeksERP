import { differenceInCalendarDays } from "date-fns";
import { deriveWoRollup } from "./work-order-rollup";
import type { Order } from "./types";

/**
 * Sipariş listesinde termin riski sinyali — termin yaklaşıyor/geçti VE üretim
 * durumu belirli bir eşiğin altında. Termin eşiği DeadlineBadge ile AYNI
 * `differenceInCalendarDays` fonksiyonunu kullanır → ikon ve rozet asla çelişmez.
 *
 * İki değişkenin birleşimi olduğundan (termin + rollup) DeadlineBadge'e SOKULMAZ
 * (o saf, domain'siz, WorkOrders listesiyle paylaşılan tarih bileşeni). Burada,
 * sipariş-domain'i bilen ayrı saf fonksiyonda hesaplanır.
 */

/**
 * Risk kuralı — TEK NOKTA. Kullanıcı kararıyla DAR ("iş emri açılmamış") varsayılan.
 *  - NO_WORK_ORDER: termin yakın/geçmiş VE hiç aktif İE yok (rollup NONE).
 *  - NOT_COMPLETED: termin yakın/geçmiş VE üretim tamamlanmamış (rollup ≠ COMPLETED).
 * Kuralı değiştirmek için yalnız bu sabit güncellenir.
 */
export type DeadlineRiskRule = "NO_WORK_ORDER" | "NOT_COMPLETED";
export const DEADLINE_RISK_RULE: DeadlineRiskRule = "NO_WORK_ORDER";

/** Termin bu kadar gün veya daha az kaldıysa (geçmiş dahil) risk penceresi. */
const RISK_WINDOW_DAYS = 3;

export interface DeadlineRisk {
  daysLeft: number;
  overdue: boolean;
  label: string;
}

export function deriveDeadlineRisk(
  order: Pick<Order, "deadline" | "status" | "lines">,
  today: Date = new Date(),
  rule: DeadlineRiskRule = DEADLINE_RISK_RULE,
): DeadlineRisk | null {
  // Termin yoksa risk hesaplanamaz.
  if (!order.deadline) return null;
  // Kapanan/iptal olan sipariş risk taşımaz.
  if (order.status === "COMPLETED" || order.status === "CANCELLED") return null;

  const daysLeft = differenceInCalendarDays(new Date(order.deadline), today);
  if (daysLeft > RISK_WINDOW_DAYS) return null;

  const { state } = deriveWoRollup(order.lines);
  const atRisk =
    rule === "NO_WORK_ORDER" ? state === "NONE" : state !== "COMPLETED";
  if (!atRisk) return null;

  const overdue = daysLeft < 0;
  const when = overdue ? "Termin geçti" : "Termin yaklaşıyor";
  const why =
    rule === "NO_WORK_ORDER" ? "iş emri açılmamış" : "üretim tamamlanmamış";
  return { daysLeft, overdue, label: `${when} — ${why}` };
}
