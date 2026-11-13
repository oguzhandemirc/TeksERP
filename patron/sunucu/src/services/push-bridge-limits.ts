// PUSH KÖPRÜSÜ HIZ SINIRI — kurulum başına, süreç içi dakikalık pencere. Kapı (`push-bridge-auth.ts`) imza + hak
// denetiminden SONRA, nonce yazımından ÖNCE çağırır: tavanı aşan istek merkez tabloya satır yazdıramaz.
import { CloudError } from "../lib/errors";
import type { CloudContext } from "./context";

/** Kayıt/bırak için kurulum başına dakikalık tavan (dürt tavanı `KOPRU_DURT_DK`). */
export const PUSH_BRIDGE_REGISTER_PER_MIN = 60;

export type BridgeLimitKind = "nudge" | "register";

class InstallationLimiter {
  private readonly windows = new Map<string, { window: number; count: number }>();
  /** null = geçti; sayı = kaç saniye sonra yeniden denenebilir. */
  hit(key: string, nowMs: number, perMinute: number): number | null {
    const window = Math.floor(nowMs / 60_000);
    const cur = this.windows.get(key);
    if (!cur || cur.window !== window) {
      if (this.windows.size > 10_000) for (const [k, v] of this.windows) if (v.window !== window) this.windows.delete(k);
      this.windows.set(key, { window, count: 1 });
      return null;
    }
    if (cur.count >= perMinute) return Math.max(1, Math.ceil(((window + 1) * 60_000 - nowMs) / 1000));
    cur.count += 1;
    return null;
  }
}

const limiters = new WeakMap<CloudContext, Record<BridgeLimitKind, InstallationLimiter>>();

export function limitBridge(ctx: CloudContext, kind: BridgeLimitKind, installationId: string, nowMs: number): void {
  let l = limiters.get(ctx);
  if (!l) {
    l = { nudge: new InstallationLimiter(), register: new InstallationLimiter() };
    limiters.set(ctx, l);
  }
  const perMinute = kind === "nudge" ? ctx.config.KOPRU_DURT_DK : PUSH_BRIDGE_REGISTER_PER_MIN;
  const wait = l[kind].hit(installationId, nowMs, perMinute);
  if (wait !== null) throw new CloudError(429, "HIZ_SINIRI", "Bu kurulum için dakikalık anlık bildirim tavanı aşıldı", { retryAfterSn: wait });
}
