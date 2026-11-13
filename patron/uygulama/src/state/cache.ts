// SALT-OKUNUR önbellek: her okuma başarıda saklanır. `peek` saklı kopyayı (savedAt ile) verir — ekran onu ANINDA
// "bayat" etiketiyle çizer, arkadan `load` tazeler (SWR, K1). `load` yalnız AĞ hatasında son veriyi döner
// ("çevrimdışı — son veri <zaman>"). 403/404'te saklı kopya silinir — izni kalkan veri önbellekten gösterilmez.
// Kapsam hesap+tesis; çıkışta hepsi silinir. `maxAgeMs` verilirse (ERP kipi: 7 gün) daha eski kopya gösterilmez ve silinir.
import { ApiError } from "../api/client";
import type { KeyValue, ListedStore } from "./browser-store";

const PREFIX = "patron:onbellek:";

export interface Cached<T> {
  readonly data: T;
  readonly offline: boolean;
  /** Verinin sunucudan alındığı an (çevrimiçiyse şimdi). */
  readonly savedAt: string;
}

export interface Cache {
  load<T>(key: string, fetcher: () => Promise<T>): Promise<Cached<T>>;
  peek<T>(key: string): Promise<Cached<T> | null>;
}

/** ERP kipinde cihazda saklı verinin ömrü. */
export const ERP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function expired(savedAt: string, maxAgeMs: number | undefined, nowMs: number): boolean {
  if (maxAgeMs === undefined) return false;
  const t = Date.parse(savedAt);
  return !Number.isFinite(t) || nowMs - t > maxAgeMs;
}

export function createCache(store: KeyValue, scope: string, now: () => Date = () => new Date(), maxAgeMs?: number): Cache {
  const full = (key: string) => `${PREFIX}${scope}:${key}`;
  async function peek<T>(key: string): Promise<Cached<T> | null> {
    try {
      const raw = await store.get(full(key));
      if (!raw) return null;
      const e = JSON.parse(raw) as { savedAt?: unknown; data?: unknown };
      if (typeof e.savedAt !== "string") return null;
      if (expired(e.savedAt, maxAgeMs, now().getTime())) {
        await store.remove(full(key)).catch(() => undefined);
        return null;
      }
      return { data: e.data as T, offline: true, savedAt: e.savedAt };
    } catch {
      return null;
    }
  }
  return {
    peek,
    async load<T>(key: string, fetcher: () => Promise<T>): Promise<Cached<T>> {
      try {
        const data = await fetcher();
        const savedAt = now().toISOString();
        await store.set(full(key), JSON.stringify({ savedAt, data })).catch(() => undefined);
        return { data, offline: false, savedAt };
      } catch (err) {
        if (err instanceof ApiError && err.kind === "AG") {
          const hit = await peek<T>(key);
          if (hit) return hit;
        }
        if (err instanceof ApiError && (err.kind === "YETKI" || err.kind === "BULUNAMADI")) {
          await store.remove(full(key)).catch(() => undefined);
        }
        throw err;
      }
    },
  };
}

/** Çıkışta ya da hesap değişiminde: bütün önbellek silinir. */
export async function clearCache(store: Pick<ListedStore, "keys" | "removeMany">): Promise<void> {
  try {
    const keys = (await store.keys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length > 0) await store.removeMany(keys);
  } catch {
    // depo erişilemezse bir sonraki girişte kapsam anahtarı zaten farklıdır
  }
}

/** Süresi geçmiş saklı kopyaları siler (açılışta; ERP kipi). Okunamayan kayıt da silinir. */
export async function purgeExpired(store: ListedStore, maxAgeMs: number, nowMs: number = Date.now()): Promise<void> {
  try {
    const old: string[] = [];
    for (const k of await store.keys()) {
      if (!k.startsWith(PREFIX)) continue;
      const raw = await store.get(k);
      let savedAt: unknown = null;
      try {
        savedAt = raw ? (JSON.parse(raw) as { savedAt?: unknown }).savedAt : null;
      } catch {
        savedAt = null;
      }
      if (typeof savedAt !== "string" || expired(savedAt, maxAgeMs, nowMs)) old.push(k);
    }
    if (old.length > 0) await store.removeMany(old);
  } catch {
    // depo erişilemezse okuma anında `peek` yine süreyi uygular
  }
}

/**
 * Açılış hijyeni: eski sürümün kalıcı (web localStorage) önbelleği HER açılışta silinir; oturum (belirteç +
 * kapsam) yoksa düz depodaki önbellek de silinir — oturumsuz cihazda önceki hesabın verisi kalmaz.
 */
export async function openingCacheHygiene(g: { plain: Pick<ListedStore, "keys" | "removeMany">; legacy: Pick<ListedStore, "keys" | "removeMany"> | null; hasSession: boolean }): Promise<void> {
  if (g.legacy) await clearCache(g.legacy);
  if (!g.hasSession) await clearCache(g.plain);
}
