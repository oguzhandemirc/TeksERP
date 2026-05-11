import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

interface Props {
  pagination: Pagination;
}

const PAGE_SIZE_OPTIONS = [50, 100];

export function DataTablePagination({ pagination }: Props) {
  const { loaded, total, hasMore, isFetchingMore, pageSize, loadMore, setPageSize } = pagination;

  return (
    <div className="flex items-center justify-between gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
      <div>
        {total != null
          ? `Yüklü ${loaded.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")} kayıt`
          : `Yüklü ${loaded.toLocaleString("tr-TR")} kayıt`}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => loadMore()}
          disabled={!hasMore || isFetchingMore}
        >
          {isFetchingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {hasMore ? "Daha Fazla Yükle" : "Tüm kayıtlar yüklendi"}
        </Button>
        <select
          className="h-7 rounded-md border bg-background px-2 text-xs"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}/sf
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
