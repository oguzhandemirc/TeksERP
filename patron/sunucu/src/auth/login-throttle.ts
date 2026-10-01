// GİRİŞ KİLİDİ — hesap + KAYNAK ikilisine bağlıdır: ardışık başarısızlık eşiği yalnız o kaynaktan gelen denemeleri
// süreli durdurur, başka kaynaktan doğru üçlü girer — hesap düzeyi kilit, e-postayı bilen herkesin elinde süresiz
// hizmet engeline dönüşüyordu. Bellek içi (tek süreç; yeniden başlatmada sıfırlanır), kaynak adresi düz saklanmaz.
import { createHmac, randomBytes } from "node:crypto";

interface Entry {
  fails: number;
  lockedUntil: number;
  lastAt: number;
}

const MAX_ENTRIES = 10_000;

export class LoginThrottle {
  /** Süreç başına rastgele anahtar: kaynak adresi bellekte de yalnız anahtarlı özet olarak durur. */
  private readonly key = randomBytes(32);
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly threshold: number,
    private readonly lockMs: number,
  ) {}

  private slot(accountId: string, source: string | null): string {
    const digest = createHmac("sha256", this.key).update(source && source !== "?" ? source : "?").digest("base64url").slice(0, 22);
    return `${accountId}|${digest}`;
  }

  private live(slot: string, nowMs: number): Entry | undefined {
    const e = this.entries.get(slot);
    if (!e) return undefined;
    // Kilit bitmiş ve son denemenin üstünden kilit süresi geçmişse sayaç söner (ardışıklık penceresi).
    if (e.lockedUntil <= nowMs && nowMs - e.lastAt >= this.lockMs) {
      this.entries.delete(slot);
      return undefined;
    }
    return e;
  }

  isLocked(accountId: string, source: string | null, nowMs: number): boolean {
    const e = this.live(this.slot(accountId, source), nowMs);
    return e !== undefined && e.lockedUntil > nowMs;
  }

  /** Başarısızlığı sayar; eşik bu denemeyle aşıldıysa kilidin bitişini döner. */
  registerFailure(accountId: string, source: string | null, nowMs: number): Date | null {
    const slot = this.slot(accountId, source);
    const e = this.live(slot, nowMs) ?? { fails: 0, lockedUntil: 0, lastAt: nowMs };
    if (e.lockedUntil > nowMs) {
      e.lastAt = nowMs;
      this.entries.set(slot, e);
      return null;
    }
    e.fails += 1;
    e.lastAt = nowMs;
    let locked: Date | null = null;
    if (e.fails >= this.threshold) {
      e.lockedUntil = nowMs + this.lockMs;
      e.fails = 0;
      locked = new Date(e.lockedUntil);
    }
    this.entries.delete(slot);
    this.entries.set(slot, e);
    this.prune(nowMs);
    return locked;
  }

  clear(accountId: string, source: string | null): void {
    this.entries.delete(this.slot(accountId, source));
  }

  /** Bellek tavanı: önce sönmüş girdiler, sonra en eski dokunulanlar düşer. */
  private prune(nowMs: number): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    for (const [slot] of this.entries) if (!this.live(slot, nowMs)) this.entries.delete(slot);
    for (const slot of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(slot);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

const throttles = new WeakMap<object, LoginThrottle>();

/** Bağlam başına tek kilit defteri (sunucu tek bağlamla kalkar; bekçi kendi bağlamını kurar). */
export function loginThrottleFor(ctx: { readonly config: { readonly GIRIS_ESIGI: number; readonly KILIT_DK: number } }): LoginThrottle {
  let t = throttles.get(ctx);
  if (!t) {
    t = new LoginThrottle(ctx.config.GIRIS_ESIGI, ctx.config.KILIT_DK * 60_000);
    throttles.set(ctx, t);
  }
  return t;
}
