import type { ReactNode } from "react";
import { ListFooter } from "@/components/layout/ListPage";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

interface Props {
  pagination: Pagination;
  /** Sağ tarafa (sayfa-boyutu seçicinin soluna) eklenen aksiyonlar — ör. "Tümünü
   *  İndir" + "Envanter Özeti". Sayfa bunları buraya koyabilir (kalıcı görünür). */
  actions?: ReactNode;
}

const PAGE_SIZE_OPTIONS = [50, 100];

/**
 * Cursor pagination footer — sayfa numarası YOK, buton da YOK. Sonraki sayfa liste
 * dibine gelince otomatik yüklenir (DataTable içindeki useInfiniteScroll sentinel'i).
 * Görünüm liste standardının alt şeridi (`ListFooter`): yüklü/toplam + durum; buraya yalnız sayfa boyu eklenir.
 */
export function DataTablePagination({ pagination, actions }: Props) {
  const { loaded, total, hasMore, isFetchingMore, pageSize, setPageSize } = pagination;

  return (
    <ListFooter loaded={loaded} total={total} hasMore={hasMore} isFetchingMore={isFetchingMore}>
      {actions}
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
    </ListFooter>
  );
}
