// Patron push belirteci durum kümesi — TS aynası migration `20261113160000_patron_push_tokens` CHECK'lerinin.
import type { Prisma } from "@prisma/client";

export const PUSH_TOKEN_STATES = ["BEKLIYOR", "KAYITLI", "BIRAKILACAK", "BIRAKILDI"] as const;
export type PushTokenState = (typeof PUSH_TOKEN_STATES)[number];

/** Canlı = ham belirteç duruyor; bulutta bağlı ya da bağlanmayı bekliyor. */
export const LIVE_STATES = ["BEKLIYOR", "KAYITLI"] as const;

/** Bırakma yazımı — ham belirteç silinir (DB CHECK `sealed_live_ck` ikizi), geri çekilme sıfırlanır. */
export const RELEASE_DATA = {
  cloudState: "BIRAKILACAK",
  tokenSealed: null,
  attempts: 0,
  nextAttemptAt: null,
  lastErrorCode: null,
} as const satisfies Prisma.PatronPushTokenUpdateManyMutationInput;


const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;

/** Satır başına geri çekilme (belirteç turu + dürt kuyruğu ortak): 30 sn × 2^(n-1), ≤ 1 sa. */
export function pushBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 10));
}
