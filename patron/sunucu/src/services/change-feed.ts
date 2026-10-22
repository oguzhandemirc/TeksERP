// DEĞİŞİM AKIŞI — uzun yoklama `GET /api/degisim` (patron v2 K1). Sayaç `sync_state.change_counter`dır: kabul
// edilen veriyle biten her pakette +1 (`sync.service.ts` stampSyncState, 9201 kilidi altında). Sayaç İŞ HESABI
// DEĞİLDİR ve içerik taşımaz: yalnız "şu projeksiyonlar değişti" der, içerik normal RLS'li uçlardan çekilir.
// Hub süreç içidir (sunucu tek süreç; LISTEN yok): tesis başına bekleyenler + son 64 artışın halkası. Süreç
// yeniden başlarsa bekleyenler düşer, istemci yeniden bağlanır; halka boşsa yanıt "hepsi" der (güvenli taraf).
import type { SessionContext } from "../auth/session.service";
import { withTesis } from "../lib/tenant";
import type { ChangeFeed } from "../wire/api";
import type { CloudContext } from "./context";

/** Halkada tutulan son artış sayısı; daha eski `since` "tüm okunabilir projeksiyonlar" döner. */
export const CHANGE_RING_SIZE = 64;
/** Uzun yoklamanın üst sınırı (sn) — Cloudflare 100 sn ve Node `requestTimeout` 300 sn altında. */
export const MAX_WAIT_SECONDS = 25;

/** Halka (since, şimdi] aralığını kapsamıyor: istemci her okunabilir projeksiyonu yeniden çekmeli. */
export const ALL_CHANGED = "*";
type Changed = readonly string[] | typeof ALL_CHANGED;

interface Waiter {
  readonly since: number;
  readonly wake: () => void;
}

export class ChangeHub {
  private readonly rings = new Map<string, Map<number, readonly string[]>>();
  private readonly waiters = new Map<string, Set<Waiter>>();

  /** Paket tx'i COMMIT edildikten SONRA çağrılır (bekleyen uyanınca DB'de yeni sayacı görür). */
  notify(tesisId: string, counter: number, names: readonly string[]): void {
    const ring = this.rings.get(tesisId) ?? new Map<number, readonly string[]>();
    ring.set(counter, [...names]);
    while (ring.size > CHANGE_RING_SIZE) ring.delete(Math.min(...ring.keys()));
    this.rings.set(tesisId, ring);
    for (const w of [...(this.waiters.get(tesisId) ?? [])]) if (counter > w.since) w.wake();
  }

  /** Hub'ın bu süreçte gördüğü son sayaç (yoksa 0). */
  latest(tesisId: string): number {
    const ring = this.rings.get(tesisId);
    return ring && ring.size > 0 ? Math.max(...ring.keys()) : 0;
  }

  /** (since, current] aralığında değişen adlar; halka aralığın her adımını tutmuyorsa `*`. */
  changedBetween(tesisId: string, since: number, current: number): Changed {
    if (current <= since) return [];
    if (current - since > CHANGE_RING_SIZE) return ALL_CHANGED;
    const ring = this.rings.get(tesisId);
    if (!ring) return ALL_CHANGED;
    const out = new Set<string>();
    for (let n = since + 1; n <= current; n++) {
      const names = ring.get(n);
      if (!names) return ALL_CHANGED;
      for (const name of names) out.add(name);
    }
    return [...out];
  }

  /** Sayaç `since`i geçene, süre dolana ya da istemci kopana dek bekler; karar DB'den yeniden okunur. */
  waitFor(tesisId: string, since: number, waitMs: number, signal?: AbortSignal): Promise<void> {
    if (waitMs <= 0 || signal?.aborted || this.latest(tesisId) > since) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const set = this.waiters.get(tesisId) ?? new Set<Waiter>();
      this.waiters.set(tesisId, set);
      const done = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        set.delete(waiter);
        if (set.size === 0 && this.waiters.get(tesisId) === set) this.waiters.delete(tesisId);
        resolve();
      };
      const waiter: Waiter = { since, wake: done };
      const timer = setTimeout(done, waitMs);
      timer.unref();
      signal?.addEventListener("abort", done, { once: true });
      set.add(waiter);
    });
  }

  /** Bekleyen yoklama sayısı (tesis verilirse yalnız onun) — bekçi ve kapanış için. */
  waiting(tesisId?: string): number {
    if (tesisId) return this.waiters.get(tesisId)?.size ?? 0;
    let n = 0;
    for (const set of this.waiters.values()) n += set.size;
    return n;
  }

  /** Kapanışta bekleyenleri hemen yanıtlatır (dinleyici 25 sn açık bağlantı beklemesin). */
  releaseAll(): void {
    for (const set of [...this.waiters.values()]) for (const w of [...set]) w.wake();
  }
}

/** Süreç içi tek hub (sunucu tek süreç; zil kapısı `doorbell.ts` de süreç içidir). */
export const changeHub = new ChangeHub();

interface CounterState {
  readonly counter: number;
  readonly last: readonly string[];
  readonly factoryStamp: string | null;
}

async function readCounter(ctx: CloudContext, tesisId: string): Promise<CounterState> {
  const row = await withTesis(ctx.app, { tesisId }, (tx) =>
    tx.syncState.findUnique({ where: { tesisId }, select: { changeCounter: true, changedProjections: true, horizon: true } }),
  );
  if (!row) return { counter: 0, last: [], factoryStamp: null };
  const last = Array.isArray(row.changedProjections) ? row.changedProjections.filter((x): x is string => typeof x === "string") : [];
  return { counter: Number(row.changeCounter), last, factoryStamp: row.horizon.toISOString() };
}

/** Değişen adlar hesabın OKUYABİLDİĞİ projeksiyonlarla kesişir (izinsiz ad sızmaz); `*` = hepsi. */
function readableOnly(s: SessionContext, changed: Changed): string[] {
  if (changed === ALL_CHANGED) return [...s.projections];
  const set = new Set(changed);
  return s.projections.filter((p) => set.has(p));
}

function feed(s: SessionContext, hub: ChangeHub, since: number, st: CounterState): ChangeFeed {
  let changed: Changed;
  if (since > st.counter) changed = ALL_CHANGED; // sayaç istemcinin bildiğinden geride (başka tesis ya da yeni DB)
  else {
    changed = hub.changedBetween(s.tesisId, since, st.counter);
    // Süreç yeniden başladıysa halka boştur; tek adımlık fark DB'deki son artışın adlarıyla tam bilinir.
    if (changed === ALL_CHANGED && st.counter === since + 1) changed = st.last;
  }
  return { sayac: st.counter, degisenler: readableOnly(s, changed), fabrikaDamgasi: st.factoryStamp };
}

/** `GET /api/degisim`: sayaç `since`ten büyükse hemen; değilse ≤ `waitMs` bekler, sonra DB'yi yeniden okur. */
export async function pollChanges(
  ctx: CloudContext,
  s: SessionContext,
  q: { readonly since: number; readonly waitMs: number; readonly signal?: AbortSignal },
  hub: ChangeHub = changeHub,
): Promise<ChangeFeed> {
  const first = await readCounter(ctx, s.tesisId);
  if (first.counter !== q.since || q.waitMs <= 0) return feed(s, hub, q.since, first);
  await hub.waitFor(s.tesisId, q.since, q.waitMs, q.signal);
  if (q.signal?.aborted) return feed(s, hub, q.since, first);
  return feed(s, hub, q.since, await readCounter(ctx, s.tesisId));
}
