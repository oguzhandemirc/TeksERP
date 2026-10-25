// =============================================================================
// BİLDİRİM BİRLEŞTİRME — dağıtıcı turunun saf (DB'siz) bellek-içi toplamı
// =============================================================================
// Bir outbox satırının alıcıları (kullanıcı × groupKey) anahtarında tek gelen kutusu satırına
// birleşir; yazım dağıtıcıdadır (`notification-dispatch.service.ts`, tek yazar).
// =============================================================================
import { NOTIFICATION_CATALOG, type NotificationCatalogEntry } from "../../constants/notification-catalog";
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
  /** ALARM GUNCELLENDI: groupKey → son payload (sayaç artmaz, okunma sıfırlanmaz) + outbox id'leri. */
  updates: Map<string, { payload: string; ids: string[] }>;
  /** Bu turda dokunulan ALARM groupKey'leri — zil `alarm` olarak çalar (`alarmRev`). */
  alarmKeys: Set<string>;
}

const GROUP_KEY_MAX = 200;

/** Birleştirme anahtarı (plan §3.6): ALARM `alarm:<id>` · KOSUL `kind:subjectKey:conditionId` · OLAY dedupeKey (+ pencere kovası). */
export function notificationGroupKey(row: Pick<OutboxRow, "kind" | "subjectId" | "subjectKey" | "conditionId" | "dedupeKey" | "occurredAt">): string {
  const entry = (NOTIFICATION_CATALOG as Record<string, NotificationCatalogEntry>)[row.kind];
  let key: string;
  if (entry?.sinif === "ALARM") key = `alarm:${row.subjectId ?? row.subjectKey}`;
  else if (entry?.altTur === "KOSUL") key = `${row.kind}:${row.subjectKey}:${row.conditionId ?? "-"}`;
  else if (entry && entry.pencereSn > 0) key = `${row.dedupeKey}:${Math.floor(row.occurredAt.getTime() / 1000 / entry.pencereSn)}`;
  else key = row.dedupeKey;
  return key.slice(0, GROUP_KEY_MAX);
}

export function newBatchState(): BatchState {
  return { agg: new Map(), counts: new Map(), errors: new Map(), closeKeys: new Map(), stats: new Map(), updates: new Map(), alarmKeys: new Set() };
}

/** outbox satırının sonucu (zehirli değil): son kimlik sayıyı taşır, öncekiler 0. */
function settleIds(state: BatchState, ids: readonly string[], n: number): void {
  ids.forEach((id, i) => {
    state.counts.set(id, i === ids.length - 1 ? n : 0);
    state.errors.set(id, null);
  });
}

/**
 * ALARM satırı yönlendirmesi. GUNCELLENDI (üstlen/sustur) olay değil durumdur: sayaç artmaz, okunma
 * sıfırlanmaz, yalnız payload yenilenir → `true` (dağıtıcı atlar). Yeni kademe (OLAY) daha taze payload
 * taşır: aynı turda bekleyen güncelleme onu ezmesin diye düşer.
 */
export function routeAlarmRow(state: BatchState, src: { row: OutboxRow; entry: NotificationCatalogEntry; groupKey: string }): boolean {
  const { row, entry, groupKey } = src;
  if (entry.sinif !== "ALARM") return false;
  state.alarmKeys.add(groupKey);
  if (row.phase === "GUNCELLENDI") {
    const payload = JSON.stringify(row.payload ?? {});
    for (const a of state.agg.values()) if (a.groupKey === groupKey) a.payload = payload;
    state.updates.set(groupKey, { payload, ids: [...(state.updates.get(groupKey)?.ids ?? []), row.id] });
    return true;
  }
  if (row.phase !== "KAPANDI" && state.updates.has(groupKey)) {
    settleIds(state, state.updates.get(groupKey)!.ids, 0);
    state.updates.delete(groupKey);
  }
  return false;
}

/** Zil iki kanaldan çalar: BİLDİRİM kutusu (`rev`) · ALARM satırı (`alarmRev`, panel alarm sorgusunu da tazeler). */
export interface TouchedUsers { box: Set<string>; alarm: Set<string> }
export function touchUser(users: TouchedUsers, state: BatchState, userId: string, groupKey: string): void {
  (state.alarmKeys.has(groupKey) ? users.alarm : users.box).add(userId);
}

/** Güncellenen açık satırlar: kullanıcılar `alarm` zilini, outbox satırları güncellenen sayıyı alır. */
export function settleAlarmUpdates(state: BatchState, rows: ReadonlyArray<{ userId: string; groupKey: string }>, users: TouchedUsers): void {
  for (const r of rows) users.alarm.add(r.userId);
  for (const [g, u] of state.updates) settleIds(state, u.ids, rows.filter((r) => r.groupKey === g).length);
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
