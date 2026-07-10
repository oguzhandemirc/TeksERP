import { Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  visibleCount: number;
  totalEstimate?: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
}

/**
 * Cursor pagination footer — sayfa numarası YOK, "Daha Fazla Yükle" var.
 * Büyük tablolarda offset cliff'inden kaçınmak için kullanılır.
 */
export function CursorPaginationFooter({
  visibleCount,
  totalEstimate,
  hasMore,
  isFetchingMore,
  onLoadMore,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
      <div>
        {totalEstimate !== undefined ? (
          <span>
            <span className="font-semibold text-foreground">
              {visibleCount.toLocaleString("tr-TR", { useGrouping: false })}
            </span>{" "}
            / {totalEstimate.toLocaleString("tr-TR", { useGrouping: false })} kayıt gösteriliyor
          </span>
        ) : (
          <span>
            <span className="font-semibold text-foreground">
              {visibleCount.toLocaleString("tr-TR", { useGrouping: false })}
            </span>{" "}
            kayıt yüklendi
          </span>
        )}
      </div>

      {hasMore ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={onLoadMore}
          disabled={isFetchingMore}
        >
          {isFetchingMore ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 mr-1" />
          )}
          Daha Fazla Yükle
        </Button>
      ) : visibleCount > 0 ? (
        <span>— son ulaşıldı —</span>
      ) : null}
    </div>
  );
}
