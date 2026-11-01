// Ekran veri kancası (SWR, K1-a): saklı kopya ANINDA çizilir (`stale: true` — "fabrika verisi <zaman>"), arkadan ağ;
// başarıda `stale: false`. Ağ hatasında son veri + çevrimdışı bandı (`offline`); bayat ≠ çevrimdışı, iki ayrı bayrak.
// 403/404 gelince ekrandaki (saklı) veri de düşer. Odak, öne gelme (≥5 sn aralık) ve etiket geçersizleştirmesi
// (`changes.ts`) yeniden çeker; odakta olmayan ekran geçersizleşirse bir sonraki odakta çeker.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../api/client";
import { dueForRefetch } from "../lib/refresh";
import { changeBus } from "./changes";
import { useSession } from "./session";
import { useForeground } from "./useForeground";
import { useScreenFocus } from "./useScreenFocus";

export interface Remote<T> {
  readonly data: T | null;
  readonly error: string | null;
  /** Son çekim 404 (kayıt/anlık yok; ör. fabrika anlığı henüz yayınlamadı) — ekran hata yerine boş durum çizebilir. */
  readonly notFound?: boolean;
  /** Bir çekim sürüyor (ilk yükleme ya da arkadan tazeleme); ekranlar `loading && !data` ile iskelet basar. */
  readonly loading: boolean;
  /** Ekranda veri varken arkadan tazeleniyor (aşağı çek göstergesi). */
  readonly refreshing: boolean;
  /** Gösterilen veri bu çekimden değil, saklı kopyadan (bayat — "fabrika verisi <zaman>"). */
  readonly stale: boolean;
  /** Ağ hatası: son veri gösteriliyor, yazma kapalı. */
  readonly offline: boolean;
  /** Verinin sunucudan alındığı an. */
  readonly savedAt: string | null;
  reload(): void;
}

export interface RemoteOptions {
  /** Geçersizleştirme etiketleri (projeksiyon adları). Verilmezse anahtardan çıkarılır (`tagsOfKey`). */
  readonly tags?: readonly string[];
}

/** Anahtardan varsayılan etiket: `anlik:<p>` · `kayit:<p>:<id>` · `veri:<p>…` → `[p]`; diğerleri yalnız "*" alır. */
export function tagsOfKey(key: string | null): string[] {
  const m = key ? /^(?:anlik|kayit|veri):([^:]+)/.exec(key) : null;
  return m ? [m[1]!] : [];
}

interface State<T> {
  data: T | null;
  error: string | null;
  notFound: boolean;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  offline: boolean;
  savedAt: string | null;
}

const blank = <T,>(loading: boolean): State<T> => ({ data: null, error: null, notFound: false, loading, refreshing: false, stale: false, offline: false, savedAt: null });

export function useRemote<T>(key: string | null, fetcher: () => Promise<T>, options: RemoteOptions = {}): Remote<T> {
  const { cache, markOnline } = useSession();
  const [state, setState] = useState<State<T>>(() => blank<T>(key !== null));
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const ident = useRef<{ key: string | null; cache: unknown } | null>(null);
  const lastFetchAt = useRef(0);
  const focused = useRef(true);
  const dirty = useRef(false);
  const firstFocus = useRef(true);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (key === null || cache === null) return;
    let alive = true;
    let settled = false;
    const same = ident.current !== null && ident.current.key === key && ident.current.cache === cache;
    ident.current = { key, cache };
    lastFetchAt.current = Date.now();
    dirty.current = false;
    // Anahtar/kapsam değişti: önceki ekranın verisi yeni anahtarın üstünde gösterilmez.
    setState((s) => (same ? { ...s, loading: true, refreshing: s.data !== null, error: null, notFound: false } : blank<T>(true)));
    if (!same) {
      cache
        .peek<T>(key)
        .then((hit) => {
          if (!alive || settled || !hit) return;
          setState((s) => (s.data !== null ? s : { ...s, data: hit.data, savedAt: hit.savedAt, stale: true, offline: false, refreshing: true }));
        })
        .catch(() => undefined);
    }
    cache
      .load(key, fetcherRef.current)
      .then((r) => {
        settled = true;
        if (!alive) return;
        markOnline(!r.offline, r.savedAt);
        setState({ data: r.data, error: null, notFound: false, loading: false, refreshing: false, stale: r.offline, offline: r.offline, savedAt: r.savedAt });
      })
      .catch((err: unknown) => {
        settled = true;
        if (!alive) return;
        // İzni kalkan / silinen kayıt: önbellek sildi, ekrandaki saklı kopya da düşer.
        const drop = err instanceof ApiError && (err.kind === "YETKI" || err.kind === "BULUNAMADI");
        setState((s) => ({
          ...s,
          ...(drop ? { data: null, savedAt: null, stale: false } : null),
          error: errorMessage(err),
          notFound: err instanceof ApiError && err.kind === "BULUNAMADI",
          loading: false,
          refreshing: false,
        }));
      });
    return () => {
      alive = false;
    };
  }, [key, cache, tick]);

  // Etiket geçersizleştirmesi (değişim akışı / zil): odaktaysa hemen, değilse bir sonraki odakta.
  const tagKey = (options.tags ?? tagsOfKey(key)).join("\u0000");
  useEffect(() => {
    if (key === null) return;
    const tags = tagKey === "" ? [] : tagKey.split("\u0000");
    return changeBus.subscribe(tags, () => {
      if (focused.current) reload();
      else dirty.current = true;
    });
  }, [key, tagKey, reload]);

  useScreenFocus(
    useCallback(() => {
      focused.current = true;
      if (firstFocus.current) firstFocus.current = false;
      else if (dirty.current || dueForRefetch(lastFetchAt.current, Date.now())) reload();
      return () => {
        focused.current = false;
      };
    }, [reload]),
  );

  useForeground(() => {
    if (!focused.current) dirty.current = true;
    else if (dueForRefetch(lastFetchAt.current, Date.now())) reload();
  });

  return { ...state, reload };
}
