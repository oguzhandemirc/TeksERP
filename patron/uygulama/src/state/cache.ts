// Çevrimdışı SALT-OKUNUR önbellek: her okuma başarıda saklanır; yalnız AĞ hatasında son veri döner
// ("çevrimdışı — son veri <zaman>"). Yetki düşerse (403) saklı kopya da silinir — izni kalkan veri
// önbellekten gösterilmez. Kapsam hesap+tesis; çıkışta hepsi silinir.
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

export function createCache(store: KeyValue, scope: string, now: () => Date = () => new Date()): Cache {
  const full = (key: string) => `${PREFIX}${scope}:${key}`;
  async function peek<T>(key: string): Promise<Cached<T> | null> {
    try {
      const raw = await store.get(full(key));
      if (!raw) return null;
      const e = JSON.parse(raw) as { savedAt?: unknown; data?: unknown };
      return typeof e.savedAt === "string" ? { data: e.data as T, offline: true, savedAt: e.savedAt } : null;
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

/**
 * Açılış hijyeni: eski sürümün kalıcı (web localStorage) önbelleği HER açılışta silinir; oturum (belirteç +
 * kapsam) yoksa düz depodaki önbellek de silinir — oturumsuz cihazda önceki hesabın verisi kalmaz.
 */
export async function openingCacheHygiene(g: { plain: Pick<ListedStore, "keys" | "removeMany">; legacy: Pick<ListedStore, "keys" | "removeMany"> | null; hasSession: boolean }): Promise<void> {
  if (g.legacy) await clearCache(g.legacy);
  if (!g.hasSession) await clearCache(g.plain);
}
