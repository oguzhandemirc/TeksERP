// Özet şeridi: durum başına adet — liste ile AYNI süzgeç; sayı sunucuda tek where'den doğar.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { EIrsaliyeStatus, eIrsaliyeStatusLabels } from "@/types/enums";
import { EIRSALIYE_RECORDS_KEY } from "./useEIrsaliye";
import { eIrsaliyeService } from "./service";

export function EIrsaliyeSummaryStrip() {
  const [sp] = useSearchParams();
  const params = useMemo(() => {
    const p = parseUrlToQueryParams(sp.toString(), { pageSize: 50 });
    return { search: p.search, filters: p.filters ?? {} };
  }, [sp]);
  const q = useQuery({
    queryKey: [EIRSALIYE_RECORDS_KEY, "summary", params],
    queryFn: () => eIrsaliyeService.summary(params),
  });
  if (!q.data) return null;
  const items = Object.values(EIrsaliyeStatus).filter((s) => (q.data.byStatus[s] ?? 0) > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm" data-testid="eirsaliye-summary">
      <span>
        <span className="text-muted-foreground">Toplam</span> <b className="tabular-nums">{q.data.total}</b>
      </span>
      {items.map((s) => (
        <span key={s}>
          <span className="text-muted-foreground">{eIrsaliyeStatusLabels[s]}</span>{" "}
          <b className="tabular-nums">{q.data.byStatus[s]}</b>
        </span>
      ))}
    </div>
  );
}
