import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
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
 * Bu çubuk yalnız durum gösterir: yüklü/toplam sayaç + yükleniyor / tümü yüklendi.
 */
export function DataTablePagination({ pagination, actions }: Props) {
  const { loaded, total, hasMore, isFetchingMore, pageSize, setPageSize } = pagination;

  return (
    <div className="flex items-center justify-between gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
      <div>
        {total != null
          ? `Yüklü ${loaded.toLocaleString("tr-TR", { useGrouping: false })} / ${total.toLocaleString("tr-TR", { useGrouping: false })} kayıt`
          : `Yüklü ${loaded.toLocaleString("tr-TR", { useGrouping: false })} kayıt`}
      </div>
      <div className="flex items-center gap-3">
        {isFetchingMore ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Yükleniyor…
          </span>
        ) : hasMore ? null : (
          // Hepsi yüklendiğinde düz durum yazısı.
          <span>Tüm kayıtlar yüklendi</span>
        )}
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
      </div>
    </div>
  );
}
