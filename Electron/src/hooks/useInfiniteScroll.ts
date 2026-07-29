import { useCallback, useEffect, useRef } from "react";

interface Options {
  /** Yüklenecek başka sayfa var mı (react-query `hasNextPage`). */
  hasMore: boolean;
  /** Şu an bir sonraki sayfa çekiliyor mu (react-query `isFetchingNextPage`). */
  isLoading: boolean;
  /** Sonraki sayfayı çek (react-query `fetchNextPage`). */
  onLoadMore: () => void;
  /** Sentinel görünür alana bu mesafe kala erken yükle (prefetch). Varsayılan 400px. */
  rootMargin?: string;
  /** Ana anahtar — false iken hiç yükleme yapılmaz. Varsayılan true. */
  enabled?: boolean;
}

/**
 * Sonsuz kaydırma: liste sonuna gelince (veya `rootMargin` kadar yaklaşınca)
 * `onLoadMore`'u OTOMATİK tetikler — "Daha Fazla Yükle" butonu gerekmez.
 *
 * İki callback-ref döner:
 *  - `rootRef`  → kaydırılan kapsayıcıya (PageBody / DataTable overflow-auto) bağla.
 *  - `sentinelRef` → listenin EN SONUNA konan görünmez elemana bağla (kapsayıcının İÇİNDE).
 *
 * IntersectionObserver kökü = kaydırma kapsayıcısı; sentinel görünür olunca yükler.
 * Callback-ref kullanılır ki sentinel/gövde SONRADAN mount olsa (ör. ilk veri gelince)
 * observer yeniden bağlanır. Ek "kısa liste" koruması: yüklemeden sonra içerik
 * kapsayıcıyı doldurmuyorsa (scrollHeight ≈ clientHeight) sentinel hâlâ görünür kalır
 * ve IO tek eşikte tekrar tetiklemez — bu durumda elle bir tur daha yüklenir; döngü
 * kapsayıcı dolunca ya da `hasMore=false` olunca durur.
 */
export function useInfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = "400px",
  enabled = true,
}: Options) {
  // En güncel değerleri observer'ı yeniden kurmadan oku.
  const stateRef = useRef({ hasMore, isLoading, onLoadMore, enabled });
  stateRef.current = { hasMore, isLoading, onLoadMore, enabled };

  const rootElRef = useRef<HTMLElement | null>(null);
  const sentinelElRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const maybeLoad = useCallback(() => {
    const s = stateRef.current;
    if (s.enabled && s.hasMore && !s.isLoading) s.onLoadMore();
  }, []);

  const attach = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const rootEl = rootElRef.current;
    const sentinel = sentinelElRef.current;
    if (!rootEl || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) maybeLoad();
      },
      { root: rootEl, rootMargin },
    );
    io.observe(sentinel);
    observerRef.current = io;
  }, [maybeLoad, rootMargin]);

  const rootRef = useCallback(
    (node: HTMLElement | null) => {
      rootElRef.current = node;
      attach();
    },
    [attach],
  );

  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      sentinelElRef.current = node;
      attach();
    },
    [attach],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Kısa liste koruması: yükleme bitince içerik kapsayıcıyı doldurmuyorsa bir tur
  // daha yükle (sentinel hâlâ görünür ama IO eşik geçmediği için tetiklemez).
  useEffect(() => {
    if (!enabled || !hasMore || isLoading) return;
    const rootEl = rootElRef.current;
    if (rootEl && rootEl.scrollHeight <= rootEl.clientHeight + 4) maybeLoad();
  }, [enabled, hasMore, isLoading, maybeLoad]);

  return { rootRef, sentinelRef };
}
