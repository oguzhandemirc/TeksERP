// Özet şeridi: durum başına adet — liste ile AYNI süzgeç; sayı sunucuda tek where'den doğar.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { BandStats, ListBand } from "@/components/layout/ListPage";
import { EIrsaliyeStatus, eIrsaliyeStatusLabels } from "@/types/enums";
import { EIRSALIYE_RECORDS_KEY } from "./useEIrsaliye";
import { eIrsaliyeService } from "./service";

/** `ready`: liste filtre kaydı URL'ye yazılana dek bekler (açılışta çift istek olmasın). */
export function EIrsaliyeSummaryStrip({ ready = true }: { ready?: boolean }) {
  const [sp] = useSearchParams();
  const params = useMemo(() => {
    const p = parseUrlToQueryParams(sp.toString(), { pageSize: 50 });
    return { search: p.search, filters: p.filters ?? {} };
  }, [sp]);
  const q = useQuery({
    queryKey: [EIRSALIYE_RECORDS_KEY, "summary", params],
    queryFn: () => eIrsaliyeService.summary(params),
    enabled: ready,
  });
  if (!q.data) return null;
  const items = Object.values(EIrsaliyeStatus).filter((s) => (q.data.byStatus[s] ?? 0) > 0);
  return (
    <ListBand data-testid="eirsaliye-summary">
      <BandStats
        label="e-İrsaliye özeti"
        items={[
          { key: "total", label: "Toplam", value: q.data.total },
          ...items.map((s) => ({ key: s, label: eIrsaliyeStatusLabels[s], value: q.data.byStatus[s] ?? 0 })),
        ]}
      />
    </ListBand>
  );
}
