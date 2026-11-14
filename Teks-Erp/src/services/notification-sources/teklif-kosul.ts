// =============================================================================
// TEKLİF KOŞUL KAYNAĞI — `teklif.suresi-doldu` (KOSUL, S2)
// =============================================================================
// Konu kümesi teklif listesinin `suresiDoldu` süzgeciyle AYNI yüklemden: `quoteExpiredWhere(quoteToday())`
// (SENT ∧ geçerlilik < fabrika günü). Kabul/red/revizyon teklifi SENT'ten çıkarır → motor "çözüldü" yazar.
// Ayrı dosya: teklif maliyet modülünün modelidir, sipariş/iş emri import zincirine girmez (`teklif.ts` emsali).
// =============================================================================
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { fmtCalendarDate } from "../document-render/fmt-date";
import { quoteExpiredWhere, quoteToday } from "../helpers/sales-quote-state.helper";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const QUOTE_CONDITION_PERIOD_MS = 900_000;
const KIND = "teklif.suresi-doldu" satisfies NotificationKind;

export async function expiredQuoteSubjects(now: Date = new Date()): Promise<ConditionSubject[]> {
  const env = await loadNotificationVisibilityEnv(prisma, [KIND]);
  if (env.modules[getNotificationEntry(KIND).modul as ModulKey] === false) return [];
  const rows = await prisma.salesQuote.findMany({
    where: quoteExpiredWhere(quoteToday(now)),
    select: { id: true, quoteNo: true, revisionNo: true, validUntilDate: true, customer: { select: { name: true } } },
  });
  return rows.map((q) => ({
    key: q.id, type: "sales_quote", id: q.id,
    payload: {
      teklifId: q.id, teklifNo: q.revisionNo > 1 ? `${q.quoteNo}/${q.revisionNo}` : q.quoteNo,
      musteriAd: q.customer?.name ?? "—", gecerlilik: fmtCalendarDate(q.validUntilDate.toISOString()),
    },
  }));
}

export function registerQuoteConditionSources(): void {
  registerConditionSource({ kind: "teklif.suresi-doldu", periodMs: QUOTE_CONDITION_PERIOD_MS, evaluate: () => expiredQuoteSubjects() });
}
