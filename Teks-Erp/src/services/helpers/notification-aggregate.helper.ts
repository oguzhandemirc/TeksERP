// =============================================================================
// BİLDİRİM BİRLEŞTİRME — dağıtıcı turunun saf (DB'siz) bellek-içi toplamı
// =============================================================================
// Bir outbox satırının alıcıları (kullanıcı × groupKey) anahtarında tek gelen kutusu satırına
// birleşir; yazım dağıtıcıdadır (`notification-dispatch.service.ts`, tek yazar).
// =============================================================================
import type { NotificationCatalogEntry } from "../../constants/notification-catalog";
import type { InboxReason, OutboxRow } from "../notification-dispatch.service";

export interface Agg {
  userId: string; kind: string; klass: string; subjectType: string; subjectId: string | null; groupKey: string;
  n: number; firstAt: Date; lastAt: Date; lastOutboxId: string; payload: string; reason: InboxReason; km: boolean; kt: boolean;
}

export interface BatchState {
  agg: Map<string, Agg>;
  counts: Map<string, number>;
  errors: Map<string, string | null>;
  closeKeys: Map<string, string[]>; // groupKey → outbox id'leri
  stats: Map<string, { day: string; kind: string; n: number }>;
}

export function addRecipients(
  state: BatchState,
  src: { row: OutboxRow; entry: NotificationCatalogEntry; groupKey: string },
  recipients: ReadonlyArray<{ userId: string; reason: InboxReason }>,
): number {
  const { row, entry, groupKey } = src;
  const kind = row.kind;
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    const k = `${r.userId}\u0000${groupKey}`;
    const prev = state.agg.get(k);
    if (prev) {
      // Satırlar (createdAt, id) sırasında geliyor: son gelen payload/lastOutboxId'yi taşır.
      prev.n += 1;
      if (row.occurredAt < prev.firstAt) prev.firstAt = row.occurredAt;
      if (row.occurredAt >= prev.lastAt) prev.lastAt = row.occurredAt;
      prev.lastOutboxId = row.id;
      prev.payload = JSON.stringify(row.payload ?? {});
    } else {
      state.agg.set(k, {
        userId: r.userId, kind, klass: entry.sinif, subjectType: row.subjectType, subjectId: row.subjectId, groupKey,
        n: 1, firstAt: row.occurredAt, lastAt: row.occurredAt, lastOutboxId: row.id, payload: JSON.stringify(row.payload ?? {}),
        reason: r.reason, km: entry.varsayilanKanallar.includes("MASAUSTU"), kt: entry.varsayilanKanallar.includes("TABLET_SES"),
      });
    }
  }
  return seen.size;
}
