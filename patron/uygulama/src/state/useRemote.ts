// Ekran veri kancası: önbellekli okuma + yenile. Ağ hatasında son veri (çevrimdışı bandı), diğer
// hatalarda TR ileti. Anahtar değişince yeniden yükler.
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../api/client";
import { useSession } from "./session";

export interface Remote<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly offline: boolean;
  readonly savedAt: string | null;
  reload(): void;
}

export function useRemote<T>(key: string | null, fetcher: () => Promise<T>): Remote<T> {
  const { cache, markOnline } = useSession();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; offline: boolean; savedAt: string | null }>({
    data: null,
    error: null,
    loading: key !== null,
    offline: false,
    savedAt: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === null || cache === null) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    cache
      .load(key, fetcher)
      .then((r) => {
        if (!alive) return;
        markOnline(!r.offline, r.savedAt);
        setState({ data: r.data, error: null, loading: false, offline: r.offline, savedAt: r.savedAt });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState((s) => ({ ...s, error: errorMessage(err), loading: false }));
      });
    return () => {
      alive = false;
    };
    // fetcher her render'da yeni; anahtar kimliği taşır
  }, [key, cache, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
