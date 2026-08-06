import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Yüklenecek başka sayfa var mı. */
  hasMore: boolean;
  /** Şu an sonraki sayfa çekiliyor mu. */
  isFetchingMore: boolean;
  /** Yüklü kayıt sayısı — boş liste ile "son"u ayırt etmek için. */
  count: number;
  className?: string;
}

/**
 * Sonsuz kaydırma dip göstergesi + SENTINEL. Bu elemanın KENDİSİ IntersectionObserver
 * hedefidir: ref'ini `useInfiniteScroll().sentinelRef`'e bağla ve listenin EN SONUNA,
 * kaydırılan gövdenin (PageBody) içine koy. Buton YOK — kaydırınca otomatik yüklenir;
 * yalnız durum gösterir (yükleniyor / tümü yüklendi). Boşken de DOM'da kalır ki
 * observer bağlı kalsın.
 */
export const AutoLoadMore = forwardRef<HTMLDivElement, Props>(function AutoLoadMore(
  { hasMore, isFetchingMore, count, className },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden={!isFetchingMore}
      className={cn(
        "flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground",
        className,
      )}
    >
      {isFetchingMore ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Yükleniyor…
        </>
      ) : !hasMore && count > 0 ? (
        <span>Tüm kayıtlar yüklendi</span>
      ) : null}
    </div>
  );
});
