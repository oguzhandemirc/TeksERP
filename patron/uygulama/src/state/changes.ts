// Değişim akışı (K1-c): ön plandaki uygulama `GET /api/degisim?since=&bekle=25` ile bulutun tesis sayacına abone
// olur; `degisenler` (projeksiyon adları) etiketli `useRemote`ları geçersizleştirir, `fabrikaDamgasi` oturumu tazeler.
// TEK döngü, yalnız ön planda ve oturum hazırken (pil); eski sunucu (404) → 60 sn'de bir "*" yayını (yoklama kipi).
import { useEffect, useRef, useState } from "react";
import { ApiError, createClient } from "../api/client";
import { pathOf } from "../api/endpoints";
import type { ChangeFeed } from "../api/wire";
import { useAppActive } from "./useForeground";

export type { ChangeFeed };

/** Bütün etiketler (yoklama kipi, sayaç geri gitti, zil sonrası). */
export const ALL_TAGS = "*";
/** Uzun yoklamada sunucunun bekleyeceği azami süre (sn) — Cloudflare 100 sn sınırının altında. */
export const LONG_POLL_WAIT_S = 25;
/** Eski sunucu (uç yok, 404): bu aralıkla görünür ekranlar yeniden çeker. */
export const POLL_FALLBACK_MS = 60_000;
/** Ağ/5xx hatasında art arda geri çekilme; son değer tavandır. */
export const FEED_BACKOFF_MS: readonly number[] = [5_000, 10_000, 30_000, 60_000];
/** İki istek arası en kısa süre (sunucu `bekle`yi yok saysa da istek seli olmaz). */
export const FEED_MIN_GAP_MS = 2_000;
/** Uzun yoklamanın istemci zaman aşımı: bekleme + pay. */
export const FEED_TIMEOUT_MS = (LONG_POLL_WAIT_S + 15) * 1_000;

export type FeedMode = "kapali" | "uzun" | "yoklama";

// ---------- geçersizleştirme veriyolu ----------

type Listener = () => void;

export interface InvalidationBus {
  /** `tags` boşsa yalnız "*" yayınına abone olur. */
  subscribe(tags: readonly string[], listener: Listener): () => void;
  invalidate(tags: readonly string[]): void;
}

/** Yayın etiketleri aboneye dokunuyor mu: "*" herkese; yoksa kesişim. */
export function tagsMatch(subscribed: readonly string[], emitted: readonly string[]): boolean {
  if (emitted.includes(ALL_TAGS)) return true;
  return emitted.some((t) => subscribed.includes(t));
}

export function createInvalidationBus(): InvalidationBus {
  const subs = new Set<{ tags: readonly string[]; listener: Listener }>();
  return {
    subscribe(tags, listener) {
      const s = { tags, listener };
      subs.add(s);
      return () => void subs.delete(s);
    },
    invalidate(tags) {
      if (tags.length === 0) return;
      for (const s of [...subs]) if (tagsMatch(s.tags, tags)) s.listener();
    },
  };
}

/** Uygulama genelinde TEK veriyolu. */
export const changeBus = createInvalidationBus();

/** Etiketli veri kancalarını yeniden çektirir (`"*"` = hepsi). Odakta olmayan ekran bir sonraki odakta çeker. */
export function invalidate(tags: readonly string[]): void {
  changeBus.invalidate(tags);
}

// ---------- ağ ----------

export interface FeedQuery {
  readonly since: number;
  readonly bekle: number;
}

export type FetchChanges = (q: FeedQuery, signal: AbortSignal) => Promise<ChangeFeed>;

function parseFeed(x: unknown): ChangeFeed {
  const o = (typeof x === "object" && x !== null ? x : {}) as { sayac?: unknown; degisenler?: unknown; fabrikaDamgasi?: unknown };
  if (typeof o.sayac !== "number" || !Number.isFinite(o.sayac) || !Array.isArray(o.degisenler)) {
    throw new ApiError(502, "SUNUCU_HATASI", "Değişim akışı yanıtı tanınmadı");
  }
  return {
    sayac: o.sayac,
    degisenler: o.degisenler.filter((t): t is string => typeof t === "string"),
    fabrikaDamgasi: typeof o.fabrikaDamgasi === "string" ? o.fabrikaDamgasi : null,
  };
}

/**
 * Uzun yoklama istemcisi: ortak istemciyle aynı zarf/hata okuması (`details.code`, 401 → oturum düşer), yalnız
 * zaman aşımı uzundur ve açık istek `signal` ile iptal edilir (arka plan / çıkış).
 */
export function createFeedFetcher(o: { baseUrl: string; getToken: () => string | null; onUnauthorized?: () => void; fetchImpl?: typeof fetch }): FetchChanges {
  return (q, signal) => {
    const base = o.fetchImpl ?? fetch;
    const linked: typeof fetch = (input, init) => {
      const ctrl = new AbortController();
      const abort = () => ctrl.abort();
      const inner = init?.signal ?? null;
      if (signal.aborted || inner?.aborted) ctrl.abort();
      signal.addEventListener("abort", abort);
      inner?.addEventListener("abort", abort);
      return base(input, { ...init, signal: ctrl.signal }).finally(() => {
        signal.removeEventListener("abort", abort);
        inner?.removeEventListener("abort", abort);
      });
    };
    const client = createClient({ baseUrl: o.baseUrl, getToken: o.getToken, onUnauthorized: o.onUnauthorized, fetchImpl: linked, timeoutMs: FEED_TIMEOUT_MS });
    return client.get<unknown>(pathOf("changes"), { since: q.since, bekle: q.bekle }).then(parseFeed);
  };
}

// ---------- döngü ----------

export interface FeedDeps {
  readonly fetchChanges: FetchChanges;
  /** Değişen etiketler (projeksiyon adları ya da "*"). */
  readonly onChanges: (tags: readonly string[]) => void;
  /** Fabrika damgası ilk kez görüldü ya da değişti. */
  readonly onStamp?: (stamp: string) => void;
  readonly onMode?: (mode: FeedMode) => void;
}

export interface FeedHandle {
  stop(): void;
  readonly mode: FeedMode;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * Döngüyü başlatır. İlk istek `bekle=0` (yalnız sayacı öğrenir, geçersizleştirmez); sonra `since=<sayac>&bekle=25`.
 * 404 → yoklama kipi; 401 → durur (oturum zaten düşer); diğer hata → 5/10/30/60 sn geri çekilme.
 */
export function startChangeFeed(d: FeedDeps): FeedHandle {
  const ctrl = new AbortController();
  const signal = ctrl.signal;
  let mode: FeedMode = "uzun";
  const setMode = (m: FeedMode) => {
    if (m === mode) return;
    mode = m;
    d.onMode?.(m);
  };

  const run = async () => {
    let since: number | null = null;
    let lastStamp: string | null = null;
    let failures = 0;
    let lastAt = -Infinity;
    while (!signal.aborted) {
      if (mode === "yoklama") {
        await sleep(POLL_FALLBACK_MS, signal);
        if (signal.aborted) return;
        d.onChanges([ALL_TAGS]);
        continue;
      }
      const gap = lastAt + FEED_MIN_GAP_MS - Date.now();
      if (gap > 0) await sleep(gap, signal);
      if (signal.aborted) return;
      lastAt = Date.now();
      try {
        const r = await d.fetchChanges(since === null ? { since: 0, bekle: 0 } : { since, bekle: LONG_POLL_WAIT_S }, signal);
        if (signal.aborted) return;
        failures = 0;
        if (since !== null) {
          if (r.sayac < since) d.onChanges([ALL_TAGS]); // sayaç geri gitti (sunucu sıfırlandı): her şey şüpheli
          else if (r.sayac > since && r.degisenler.length > 0) d.onChanges(r.degisenler);
        }
        since = r.sayac;
        if (r.fabrikaDamgasi !== null && r.fabrikaDamgasi !== lastStamp) {
          lastStamp = r.fabrikaDamgasi;
          d.onStamp?.(r.fabrikaDamgasi);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setMode("yoklama"); // eski sunucu: uç yok
          continue;
        }
        if (err instanceof ApiError && err.kind === "OTURUM") {
          setMode("kapali");
          ctrl.abort();
          return;
        }
        const wait = FEED_BACKOFF_MS[Math.min(failures, FEED_BACKOFF_MS.length - 1)]!;
        failures += 1;
        await sleep(wait, signal);
      }
    }
  };
  void run();
  return {
    stop() {
      ctrl.abort();
      setMode("kapali");
    },
    get mode() {
      return mode;
    },
  };
}

/**
 * Oturum düzeyinde TEK abonelik: `enabled` (oturum hazır) ∧ ön plan iken döngü koşar; arka plana geçince ya da
 * oturum düşünce durur ve açık istek iptal edilir. `resetKey` değişince (tesis geçişi) sayaç sıfırdan başlar.
 */
export function useChangeFeed(o: {
  enabled: boolean;
  fetchChanges: FetchChanges | null;
  resetKey?: string | null;
  onChanges?: (tags: readonly string[]) => void;
  onStamp?: (stamp: string) => void;
}): FeedMode {
  const active = useAppActive();
  const [mode, setMode] = useState<FeedMode>("kapali");
  const cbs = useRef(o);
  cbs.current = o;
  const run = o.enabled && active && o.fetchChanges !== null;
  const fetcher = o.fetchChanges;
  useEffect(() => {
    if (!run || fetcher === null) return;
    setMode("uzun");
    const h = startChangeFeed({
      fetchChanges: fetcher,
      onChanges: (tags) => (cbs.current.onChanges ?? invalidate)(tags),
      onStamp: (s) => cbs.current.onStamp?.(s),
      onMode: setMode,
    });
    return () => h.stop();
  }, [run, fetcher, o.resetKey]);
  return mode;
}
