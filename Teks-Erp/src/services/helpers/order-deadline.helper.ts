// =============================================================================
// SİPARİŞ TERMİN GECİKMESİ — TEK KAYNAK
// =============================================================================
// "Termini geçti mi, kaç gün" sorusu iki AN arasındaki farktır (takvim günü sorusu
// değil; fabrika saat diliminden bağımsız). Açık sipariş karşılama raporu ile patron
// bulutu projeksiyonu (`cloud-sync` · `gecikmis`) ve bildirim koşulları (`siparis.termin-*`)
// aynı cevabı vermek zorunda: açık durum kümesi ve iki yüklem YALNIZ burada yazılır.
// =============================================================================
import { OrderStatus } from "@prisma/client";

const DAY_MS = 86_400_000;

/** Termin sorusunun anlamlı olduğu durumlar: hâlâ karşılanmayı bekleyen sipariş. */
export const DEADLINE_OPEN_ORDER_STATUSES: readonly OrderStatus[] = [OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED];
const OPEN_SET: ReadonlySet<string> = new Set<string>(DEADLINE_OPEN_ORDER_STATUSES);

export function isDeadlineOpenStatus(status: string): boolean {
  return OPEN_SET.has(status);
}

/** Termin geçmişse geçen TAM gün sayısı (0 = bugün geçti), geçmemişse ya da termin yoksa `null`. */
export function daysPastDeadline(deadline: Date | null | undefined, nowMs: number): number | null {
  // tz-ok: mutlak an farkı.
  if (!deadline || deadline.getTime() >= nowMs) return null;
  return Math.floor((nowMs - deadline.getTime()) / DAY_MS);
}

/** Termin henüz geçmedi ve en geç `days` gün sonra (mutlak pencere; `daysPastDeadline` ile ayrık). */
export function isDeadlineApproaching(deadline: Date | null | undefined, nowMs: number, days: number): boolean {
  // tz-ok: mutlak an farkı.
  if (!deadline || daysPastDeadline(deadline, nowMs) !== null) return false;
  return deadline.getTime() - nowMs <= days * DAY_MS;
}
