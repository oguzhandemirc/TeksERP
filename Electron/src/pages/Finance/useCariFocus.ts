// Derin bağlantı `?focus=<hesapId>` (D4-KUC3a; cari kilidi / risk limiti bildirimlerinden): hesabı sunucudan
// `filter[id]` ile çeker ve kartını (ekstre) açar — ilk 100 satırda olmasa da bulunur. Param sonra temizlenir ki
// yenileme tekrar açmasın; bulunamazsa (silinmiş/yetkisiz) sessizce geçer. Emsal: OrdersPage `?focus`.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { listCari, type CariRow } from "./service";

export function useCariFocus(open: (row: CariRow) => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  useEffect(() => {
    if (!focusId) return;
    let cancelled = false;
    listCari({ page: 1, pageSize: 1, filters: { id: focusId }, withOverdue: true })
      .then((res) => {
        const row = res.data?.find((r) => r.id === focusId);
        if (!cancelled && row) open(row);
      })
      .catch(() => {
        /* yetkisiz / ağ — sessiz, kart açılmaz; liste ekranı kendi hatasını gösterir */
      })
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("focus");
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
    // `open` her render'da yeni olabilir; tetik yalnız odak kimliğidir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);
}
