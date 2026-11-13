// Dürt yanıtının işlenmesi (sözleşme §3 tablosu) — belirteç başına etki + satır kararı. Saf karar `decideNudge`;
// belirteç yazımları koşullu `updateMany` (satır arada değiştiyse dokunulmaz). Bulutta bağ zaten silinmiş GECERSIZ
// belirteç yerelde doğrudan BIRAKILDI olur (`birak` gerekmez); BAGSIZ belirteç BEKLIYOR'a döner (yeniden `kaydet`).
import prisma from "../../lib/prisma";
import type { PushNudgeOutcome } from "../../cloud-sync/wire";
import type { BridgeResult } from "../../cloud-sync/push-bridge-client";
import type { PushNudgeResponse } from "../../cloud-sync/push-bridge-client";
import { LIVE_STATES } from "./states";
import { requestPatronPushRound } from "./wake";

export type NudgeDecision =
  | { readonly kind: "FINISH"; readonly state: "GONDERILDI" | "ATLANDI" | "VAZGECILDI"; readonly code: string | null }
  | { readonly kind: "RETRY"; readonly code: string }
  /** Tur durur, satır deneme sayılmadan bekler (lisans 401/403 · hız 429). */
  | { readonly kind: "HOLD"; readonly code: string; readonly delayMs: number; readonly pause: boolean };

const LICENSE_HOLD_MS = 5 * 60_000;
const RATE_HOLD_MS = 60_000;

/** HTTP/ağ hatası → karar. 5xx/ağ/409 belirsizdir (yeniden), kalan 4xx gövde/biçim sorunudur (vazgeç). */
export function decideTransportError(status: number, code: string): NudgeDecision {
  const tag = (status === 0 ? code : `${status}:${code}`).slice(0, 64);
  if (status === 401 || status === 403) return { kind: "HOLD", code: tag, delayMs: LICENSE_HOLD_MS, pause: false };
  if (status === 429) return { kind: "HOLD", code: tag, delayMs: RATE_HOLD_MS, pause: true };
  if (status === 0 || status >= 500 || status === 409 || status === 200) return { kind: "RETRY", code: tag };
  return { kind: "FINISH", state: "VAZGECILDI", code: tag };
}

/** Belirteç sonuçları → satır kararı. Yanıtta olmayan belirteç GECICI sayılır (yeniden; bulut aynı kimliği yinelemez). */
export function decideNudge(outcomes: readonly PushNudgeOutcome[]): NudgeDecision {
  if (outcomes.some((o) => o === "GECICI" || o === "BAGSIZ")) return { kind: "RETRY", code: outcomes.includes("BAGSIZ") ? "BAGSIZ" : "GECICI" };
  if (outcomes.includes("GONDERILDI")) return { kind: "FINISH", state: "GONDERILDI", code: null };
  if (outcomes.includes("KAPALI")) return { kind: "FINISH", state: "GONDERILDI", code: "BULUT_KAPALI" };
  if (outcomes.length > 0 && outcomes.every((o) => o === "GECERSIZ")) return { kind: "FINISH", state: "ATLANDI", code: "GECERSIZ" };
  return { kind: "FINISH", state: "VAZGECILDI", code: "KALICI" };
}

/** Yanıtı belirteçlere uygular ve satır kararını döner. `sent` = gönderilen belirteçlerin özetleri. */
export async function applyNudgeResult(res: BridgeResult<PushNudgeResponse>, sent: readonly string[], now: Date): Promise<NudgeDecision> {
  if (!res.ok) return decideTransportError(res.status, res.code);
  const byDigest = new Map(res.value.sonuclar.map((s) => [s.ozet, s.sonuc] as const));
  const invalid = new Set(res.value.gecersiz);
  for (const [d, o] of byDigest) if (o === "GECERSIZ") invalid.add(d);
  const unbound = [...byDigest].filter(([d, o]) => o === "BAGSIZ" && !invalid.has(d)).map(([d]) => d);
  if (invalid.size > 0) {
    await prisma.patronPushToken.updateMany({
      where: { tokenDigest: { in: [...invalid] }, cloudState: { in: [...LIVE_STATES] } },
      data: { cloudState: "BIRAKILDI", tokenSealed: null, releasedAt: now, attempts: 0, nextAttemptAt: null, lastErrorCode: "GECERSIZ" },
    });
  }
  if (unbound.length > 0) {
    const r = await prisma.patronPushToken.updateMany({
      where: { tokenDigest: { in: unbound }, cloudState: "KAYITLI" },
      data: { cloudState: "BEKLIYOR", attempts: 0, nextAttemptAt: null, lastErrorCode: "BAGSIZ" },
    });
    if (r.count > 0) requestPatronPushRound();
  }
  const outcomes = sent.map((d): PushNudgeOutcome => (invalid.has(d) ? "GECERSIZ" : byDigest.get(d) ?? "GECICI"));
  return decideNudge(outcomes);
}
