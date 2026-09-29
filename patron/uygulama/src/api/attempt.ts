// İşlem kimliği (clientToken/mesajId) MANTIKSAL DENEME başına bir kez üretilir; yalnız sonucu belirsiz
// bırakan hatada (ağ · zaman aşımı · 5xx) yapışır, kesin 4xx'te düşer (yeni deneme yeni kimlik).
import { ApiError } from "./client";

export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface WriteAttempt {
  /** Bu denemenin kimliği (tekrarda aynı kalır). */
  readonly id: () => string;
  /** Deneme bitti: başarıda ya da kesin hatada kimlik düşer, belirsiz hatada yapışır. */
  readonly settle: (err?: unknown) => void;
}

export function createAttempt(gen: () => string = newId): WriteAttempt {
  let current: string | null = null;
  return {
    id: () => (current ??= gen()),
    settle: (err) => {
      if (err instanceof ApiError && err.ambiguous) return;
      current = null;
    },
  };
}

/** Tek çağrı sarmalayıcısı: `fn(kimlik)` koşar, sonuca göre kimliği düşürür ya da tutar. */
export async function runAttempt<T>(attempt: WriteAttempt, fn: (id: string) => Promise<T>): Promise<T> {
  try {
    const r = await fn(attempt.id());
    attempt.settle();
    return r;
  } catch (err) {
    attempt.settle(err);
    throw err;
  }
}
