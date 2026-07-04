import type { AxiosError } from "axios";
import type { ExistingSessionInfo, SameTypeSessionPolicy } from "@/types/auth";
import { SESSION_EXISTS_CODE } from "@/types/auth";

// -----------------------------------------------------------------------------
// Saf oturum/eşzamanlılık yardımcıları — React'ten bağımsız, birim-test edilir.
// Otomatik-logout zamanlaması + same-type oturum politikası select eşlemesi +
// 409 SESSION_EXISTS dedektörü tek kaynak.
// -----------------------------------------------------------------------------

/** setTimeout'un güvenli üst sınırı (32-bit signed) — aşan gecikmeler taşar. */
export const MAX_TIMER_MS = 2_147_483_647;

/**
 * Verilen son-kullanma anına (ms epoch) göre otomatik-logout için beklenecek
 * gecikme (ms). `expMs` yoksa `null` (= zamanlayıcı kurma). Süre geçmişse 0
 * (hemen çıkış). Çok uzak tarihte `MAX_TIMER_MS`'e kırpılır (setTimeout taşmasın;
 * çağıran gerekirse yeniden zamanlar). Saf fonksiyon.
 */
export function autoLogoutDelayMs(expMs: number | null, nowMs: number): number | null {
  if (expMs === null) return null;
  const delay = expMs - nowMs;
  if (delay <= 0) return 0;
  return Math.min(delay, MAX_TIMER_MS);
}

// --- Same-type oturum politikası: değer <-> etiket eşlemesi ------------------

/** Ayarlar select'inde gösterilen politika seçenekleri (backend enum sırasıyla). */
export const SAME_TYPE_SESSION_POLICY_OPTIONS: ReadonlyArray<{
  value: SameTypeSessionPolicy;
  label: string;
}> = [
  { value: "kick", label: "Aynı tip engelli — eskiyi düşür" },
  { value: "notify", label: "Aynı tip engelli — bildir" },
  { value: "off", label: "Sınırsız" },
] as const;

export const DEFAULT_SAME_TYPE_SESSION_POLICY: SameTypeSessionPolicy = "kick";

/** Politika değeri → okunur etiket. Bilinmeyen değer → default'un etiketi. */
export function sessionPolicyLabel(value: SameTypeSessionPolicy): string {
  return (
    SAME_TYPE_SESSION_POLICY_OPTIONS.find((o) => o.value === value)?.label ??
    SAME_TYPE_SESSION_POLICY_OPTIONS[0].label
  );
}

/** Değer geçerli bir politika mı (backend/flags'ten gelen değeri sağlamlaştırır). */
export function isSameTypeSessionPolicy(v: unknown): v is SameTypeSessionPolicy {
  return v === "kick" || v === "notify" || v === "off";
}

// --- 409 SESSION_EXISTS dedektörü --------------------------------------------

interface SessionConflictBody {
  message?: string;
  details?: {
    code?: string;
    existingSession?: ExistingSessionInfo;
  };
}

/**
 * Bir Axios hatası "aynı hesap başka yerde açık" (409 SESSION_EXISTS) çakışması
 * mı? Öyleyse mevcut oturum bilgisini döndürür, değilse `null`. 'notify'
 * politikasında login bu yanıtı döner; kullanıcı onaylayınca confirmKick ile
 * tekrar denenir.
 */
export function readSessionConflict(error: unknown): ExistingSessionInfo | null {
  const err = error as AxiosError<SessionConflictBody> | undefined;
  const resp = err?.response;
  if (!resp || resp.status !== 409) return null;
  const details = resp.data?.details;
  if (details?.code !== SESSION_EXISTS_CODE) return null;
  return details.existingSession ?? { deviceType: "electron", createdAt: "", deviceId: null };
}
