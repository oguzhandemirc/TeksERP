// Günlük (GUNLUK) anlıkların yeniden deneme defteri + tur sorununun log özeti.
// Ret alan günlük anlık günü "tamam" SAYMAZ: yalnız o ad geri çekilmeyle (1 → 2 → 4 → 8 sa tavan)
// yeniden denenir; kabul edilen ad yeniden gitmez. Defter BELLEKTEdir (süreç ömrü), gün dönünce
// sıfırlanır — yeniden başlatmada günün turu zaten baştan koşar.
import { SNAPSHOT_PROJECTIONS } from "./projections";
import type { RoundOutcome } from "./sync-round";

export const DAILY_RETRY_BASE_MS = 60 * 60 * 1000;
export const DAILY_RETRY_MAX_MS = 8 * 60 * 60 * 1000;

export const DAILY_SNAPSHOT_NAMES: ReadonlySet<string> = new Set(SNAPSHOT_PROJECTIONS.filter((p) => p.cadence === "GUNLUK").map((p) => p.name));

export interface DailyRetryEntry {
  readonly attempts: number;
  readonly nextAt: number;
}

export interface ScheduledRetry {
  readonly name: string;
  readonly attempts: number;
  readonly delayMs: number;
}

export function dailyRetryDelayMs(attempts: number): number {
  return Math.min(DAILY_RETRY_MAX_MS, DAILY_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Zamanı gelmiş yeniden denemeler (periyodik tur bunları `extraSnapshots` olarak ekler). */
export function dueDailyRetries(book: ReadonlyMap<string, DailyRetryEntry>, nowMs: number): string[] {
  return [...book].filter(([, e]) => nowMs >= e.nextAt).map(([name]) => name);
}

/** Tur sonrası: denenen günlük adlardan ret alan geri çekilir, diğerleri defterden düşer. */
export function settleDailyRetry(book: Map<string, DailyRetryEntry>, attempted: Iterable<string>, o: Pick<RoundOutcome, "rejected">, nowMs: number): ScheduledRetry[] {
  const rejected = new Set(o.rejected.map((r) => r.projection.split(".")[0]!));
  const scheduled: ScheduledRetry[] = [];
  for (const name of attempted) {
    if (!DAILY_SNAPSHOT_NAMES.has(name) || !rejected.has(name)) {
      book.delete(name);
      continue;
    }
    const attempts = (book.get(name)?.attempts ?? 0) + 1;
    const delayMs = dailyRetryDelayMs(attempts);
    book.set(name, { attempts, nextAt: nowMs + delayMs });
    scheduled.push({ name, attempts, delayMs });
  }
  return scheduled;
}

export function retryNotice(r: ScheduledRetry): string {
  return `günlük anlık ${r.name} buluta geçmedi — ${Math.round(r.delayMs / 60_000)} dk sonra yeniden (deneme ${r.attempts})`;
}

/** Aynı metni `repeatMs` içinde ikinci kez geçirmez (kalıcı ret saatlik log yağmuru olmasın). */
export class RepeatGate {
  private last: { text: string; at: number } | null = null;
  constructor(private readonly repeatMs: number) {}
  pass(text: string, at: number): boolean {
    if (this.last?.text === text && at - this.last.at < this.repeatMs) return false;
    this.last = { text, at };
    return true;
  }
  age(ms: number): void {
    if (this.last) this.last = { ...this.last, at: this.last.at - ms };
  }
  reset(): void {
    this.last = null;
  }
}

/** Defteri `ms` kadar yaşlandırır (yalnız bekçi: zaman iş durumunu kaydırarak ilerler). */
export function ageDailyRetry(book: Map<string, DailyRetryEntry>, ms: number): void {
  for (const [name, e] of book) book.set(name, { ...e, nextAt: e.nextAt - ms });
}

// Bulut yanıtından gelen metin loga yalnız bu biçimlerde girer (veri/sır taşıyamaz).
const SAFE_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,47}$/;
const MAX_IN_LOG = 5;

function joinCapped(items: string[]): string {
  const head = items.slice(0, MAX_IN_LOG).join(", ");
  return items.length > MAX_IN_LOG ? `${head} (+${items.length - MAX_IN_LOG})` : head;
}

/** KISMI/HATA turunun neden özeti: `ret: <projeksiyon>=<kod>, …` + kabul edilmeyen kayıt projeksiyonları. */
export function describeRoundProblem(o: Pick<RoundOutcome, "reason" | "rejected" | "unaccepted">): string {
  if (o.reason) return o.reason;
  const ret = [...new Set(o.rejected.map((r) => `${SAFE_NAME.test(r.projection) ? r.projection : "?"}=${SAFE_CODE.test(r.code) ? r.code : "?"}`))];
  const parts: string[] = [];
  if (ret.length > 0) parts.push(`ret: ${joinCapped(ret)}`);
  if (o.unaccepted.length > 0) parts.push(`kabulsüz: ${joinCapped(o.unaccepted)}`);
  return parts.length > 0 ? parts.join("; ") : "ret";
}
