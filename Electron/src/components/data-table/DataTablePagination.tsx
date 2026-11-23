import type { ReactNode } from "react";
import { ListFooter } from "@/components/layout/ListPage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

interface Props {
  pagination: Pagination;
  /** Sağ tarafa (sayfa-boyutu seçicinin soluna) eklenen aksiyonlar — ör. "Tümünü
   *  İndir" + "Envanter Özeti". Sayfa bunları buraya koyabilir (kalıcı görünür). */
  actions?: ReactNode;
  /** Alt çubuğun solundaki özet (`<BandStats>`). */
  summary?: ReactNode;
}

const PAGE_SIZE_OPTIONS = [50, 100];

/**
 * Cursor pagination footer — sayfa numarası YOK, buton da YOK. Sonraki sayfa liste
 * dibine gelince otomatik yüklenir (DataTable içindeki useInfiniteScroll sentinel'i).
 * Görünüm liste standardının alt şeridi (`ListFooter`): yüklü/toplam + durum; buraya yalnız sayfa boyu eklenir.
 */
export function DataTablePagination({ pagination, actions, summary }: Props) {
  const { loaded, total, hasMore, isFetchingMore, pageSize, setPageSize } = pagination;

  return (
    <ListFooter loaded={loaded} total={total} hasMore={hasMore} isFetchingMore={isFetchingMore} summary={summary}>
      {actions}
      {/* Yerel <select> yerine ortak açılır (tarayıcı stili karışmasın); alt çubuk boyu. */}
      <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
        <SelectTrigger aria-label="Sayfa boyu" className="h-[var(--control-h-sm)] w-auto gap-1.5 px-2.5 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s} / sayfa
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ListFooter>
  );
}
