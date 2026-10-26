// İmleçli projeksiyon listesi, `useRemote` üstünde: ilk sayfa SWR + etiket geçersizleştirmesiyle tazelenir,
// "Daha fazla" aynı süzgeçle sonraki sayfayı ekler. Süzme ve arama SUNUCUDA; istemci listeyi süzmez.
// Arama sonucu saklanmaz (her terim ayrı anahtar doğururdu) — terimli istek doğrudan gider.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/client";
import type { Page, ProjectionRecord } from "../../api/wire";
import { useSession } from "../../state/session";
import { useRemote } from "../../state/useRemote";

export interface ListQuery {
  readonly durum?: string;
  readonly cariKartId?: string;
  readonly cariHesapId?: string;
  readonly siparisId?: string;
  readonly teklifId?: string;
  readonly ara?: string;
  readonly suzgec?: string;
}

export interface RemoteList {
  readonly items: readonly ProjectionRecord[];
  /** İlk sayfa yükleniyor ve gösterilecek veri yok (iskelet). */
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  readonly offline: boolean;
  readonly savedAt: string | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  loadMore(): void;
  reload(): void;
}

const LIMIT = 50;

export function useRemoteList(projection: string, query: ListQuery = {}, options: { limit?: number; enabled?: boolean; tags?: readonly string[] } = {}): RemoteList {
  const { api } = useSession();
  const limit = options.limit ?? LIMIT;
  const { durum, cariKartId, cariHesapId, siparisId, teklifId, suzgec } = query;
  const ara = query.ara?.trim() || undefined;
  const enabled = options.enabled ?? true;
  const params = useCallback(
    (imlec: string | undefined) => ({ imlec, limit, durum, cariKartId, cariHesapId, siparisId, teklifId, ara, suzgec }),
    [limit, durum, cariKartId, cariHesapId, siparisId, teklifId, ara, suzgec],
  );
  const ids = [cariKartId, cariHesapId, siparisId, teklifId].map((x) => x ?? "").join(":");
  const key = `veri:${projection}:${durum ?? ""}:${ids}:${suzgec ?? ""}:${limit}`;

  // Terimsiz ilk sayfa: saklı kopya + arkadan ağ + etiketle tazeleme.
  const first = useRemote<Page<ProjectionRecord>>(enabled && !ara ? key : null, () => api.list(projection, params(undefined)), { tags: options.tags ?? [projection] });

  // Terimli ilk sayfa: saklanmaz; geç dönen eski terim yenisini ezmez (etki temizliği).
  const [search, setSearch] = useState<{ term: string; page: Page<ProjectionRecord> | null; error: string | null; loading: boolean } | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  useEffect(() => {
    if (!enabled || !ara) {
      setSearch(null);
      return;
    }
    let alive = true;
    setSearch((s) => ({ term: ara, page: s?.term === ara ? s.page : null, error: null, loading: true }));
    api.list(projection, params(undefined)).then(
      (page) => alive && setSearch({ term: ara, page, error: null, loading: false }),
      (err: unknown) => alive && setSearch({ term: ara, page: null, error: errorMessage(err), loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [api, projection, params, ara, enabled, searchTick]);

  const page = ara ? (search?.page ?? null) : first.data;

  // Sonraki sayfalar ilk sayfanın kimliğine bağlı: ilk sayfa tazelenince eklenenler düşer.
  const [extra, setExtra] = useState<{ of: Page<ProjectionRecord>; items: ProjectionRecord[]; next: string | null } | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreSeq = useRef(0);
  const ownExtra = extra && extra.of === page ? extra : null;
  const next = ownExtra ? ownExtra.next : (page?.sonraki ?? null);
  const offline = ara ? false : first.offline;

  const loadMore = useCallback(() => {
    if (!page || !next || loadingMore) return;
    const mine = ++moreSeq.current;
    setLoadingMore(true);
    setMoreError(null);
    api.list(projection, params(next)).then(
      (r) => {
        if (mine !== moreSeq.current) return;
        setExtra((e) => ({ of: page, items: [...(e && e.of === page ? e.items : []), ...r.kayitlar], next: r.sonraki }));
        setLoadingMore(false);
      },
      (err: unknown) => {
        if (mine !== moreSeq.current) return;
        setMoreError(errorMessage(err));
        setLoadingMore(false);
      },
    );
  }, [api, projection, params, page, next, loadingMore]);

  const reload = useCallback(() => {
    moreSeq.current++;
    setExtra(null);
    setLoadingMore(false);
    if (ara) setSearchTick((n) => n + 1);
    else first.reload();
  }, [ara, first]);

  const items = page ? (ownExtra ? [...page.kayitlar, ...ownExtra.items] : page.kayitlar) : [];
  const loading = ara ? (search?.loading ?? true) && !search?.page : first.loading && !first.data;
  const error = ara ? (search?.error ?? null) : first.error;
  return {
    items,
    loading: enabled && loading,
    refreshing: ara ? !!search?.loading && !!search.page : first.refreshing,
    error: error ?? moreError,
    stale: ara ? false : first.stale,
    offline,
    savedAt: ara ? null : first.savedAt,
    hasMore: !!next && !offline,
    loadingMore,
    loadMore,
    reload,
  };
}
