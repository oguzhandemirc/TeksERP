// Patron telefonu dürt kuyruğu durum kümesi — TS aynası migration `20261113170000_patron_push_nudges` CHECK'lerinin.
// "Kutu satırı hâlâ dürt ister mi" sorusunun boğaz-ikizi de burada: bellek-içi `inboxWantsNudge` ↔ Prisma parçası
// `NUDGE_INBOX_LIVE_WHERE` (okunmamış ∧ çözülmemiş); iş turu iptal adımında parçayı, gönderim anında yüklemi kullanır.
import type { Prisma } from "@prisma/client";

export const NUDGE_STATES = ["BEKLIYOR", "GONDERILIYOR", "GONDERILDI", "IPTAL", "ATLANDI", "VAZGECILDI"] as const;
export type NudgeState = (typeof NUDGE_STATES)[number];
/** Canlı = partial unique `patron_push_nudges_live_inbox_uq` kümesi (kutu satırı başına en çok bir). */
export const NUDGE_LIVE_STATES = ["BEKLIYOR", "GONDERILIYOR"] as const satisfies readonly NudgeState[];
/** Terminal = `finishedAt` dolu (DB CHECK `finished_ck`). */
export type NudgeTerminal = Exclude<NudgeState, (typeof NUDGE_LIVE_STATES)[number]>;

/** Kutu satırı dürt ister: okunmamış ∧ çözülmemiş. İkizi `inboxWantsNudge`. */
export const NUDGE_INBOX_LIVE_WHERE = { readAt: null, resolvedAt: null } as const satisfies Prisma.NotificationInboxWhereInput;

export function inboxWantsNudge(row: { readAt: Date | null; resolvedAt: Date | null }): boolean {
  return row.readAt === null && row.resolvedAt === null;
}

/** Terminal yazım (claim ve sonuç alanları sıfırlanır; CHECK ikizleri). */
export function finishData(state: NudgeTerminal, code: string | null, now: Date) {
  return { state, finishedAt: now, claimedAt: null, nextAttemptAt: null, lastErrorCode: code === null ? null : code.slice(0, 64) } as const;
}
