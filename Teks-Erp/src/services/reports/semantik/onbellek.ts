// =============================================================================
// SEMANTİK KATMAN — sonuç önbelleği (R1-SEMCEK; plan §3.4)
// =============================================================================
// Anahtar = (sürüm | sistem anahtarı) + parametre özeti + kullanıcının izin/modül özeti: izni
// farklı iki kullanıcı aynı girdiyle aynı sonucu PAYLAŞMAZ. TTL tazeliktir, geçerlilik değil;
// "Yenile" okumayı atlar ama sonucu yazar. Tek process → bellek içi LRU yeterli.
// =============================================================================
import { createHash } from "node:crypto";

export const CACHE_TTL_MS = 120_000;
export const CACHE_MAX_ENTRIES = 200;

/** Anahtar sırasından bağımsız kararlı JSON (aynı girdi → aynı özet). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export class ResultCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = CACHE_TTL_MS,
    private readonly maxEntries: number = CACHE_MAX_ENTRIES,
  ) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU: okunan girdi en sona taşınır.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
