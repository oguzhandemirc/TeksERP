// =============================================================================
// SİPARİŞLER › ÜRETİM PLANI SEKMESİ (SY-K2; tasarım §12.5 madde 3) — YENİ MENÜ YOK
// =============================================================================
// Kolonlar fabrikanın plan görselinin sırasıyla: tarih · desen · varyant · metre · en · müşteri · fiyat ·
// kuşak · top boyu · not. Satır rengi SUNUCUDAN (`orderLineProductionState`); istemci renk hesaplamaz.
// Renk süzgeci URL'de (`planState`) → kayıtlı görünüm altyapısı (`SavedViewsMenu`, URL anlığı) saklar.
// =============================================================================
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { getOrderPlan, parsePlanStates, PLAN_STATE_LABEL, ORDER_PLAN_STATES, type OrderPlanState, type OrderPlanSummary } from "./orderPlanService";
import { DOT_CLASS, n, orderPlanColumns } from "./orderPlanColumns";

export const ORDER_PLAN_QUERY_KEY = "order-plan";
const PAGE = 100;

/** Renk → satır/rozet sınıfı (renk SUNUCUDAN gelir; burada yalnız görünüm). */
export const PLAN_STATE_CLASS: Record<OrderPlanState, string> = {
  WHITE: "bg-background",
  YELLOW: "bg-amber-50 dark:bg-amber-950/30",
  GREEN: "bg-emerald-50 dark:bg-emerald-950/30",
  RED: "bg-red-50 dark:bg-red-950/30",
};

export function OrderPlanView({ pricingEnabled }: { pricingEnabled: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const states = parsePlanStates(searchParams.get("planState"));
  const toggleState = (s: OrderPlanState | null) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const cur = parsePlanStates(prev.get("planState"));
      const list = s === null ? [] : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
      if (list.length === 0) next.delete("planState");
      else next.set("planState", list.join(","));
      return next;
    });

  const q = useInfiniteQuery({
    queryKey: [ORDER_PLAN_QUERY_KEY, states.join(",")],
    queryFn: ({ pageParam }) => getOrderPlan({ states, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const summary = q.data?.pages[0]?.summary;
  const columns = useMemo(() => orderPlanColumns(pricingEnabled), [pricingEnabled]);
  const table = useLocalTable({ tableKey: "orders:plan", data: rows, columns, getRowId: (r) => r.lineId });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="order-plan-view">
      <ListToolbar className="flex-row flex-wrap items-center">
        <PlanStateChips summary={summary} active={states} onToggle={toggleState} />
        <div className="ml-auto flex items-center gap-1.5">
          <SavedViewsMenu />
          <DataTableTools table={table} compact exportName="Sipariş planı" />
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} rowClassName={(r) => PLAN_STATE_CLASS[r.state]} exportName="Sipariş planı" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage className="text-center text-sm">
            <p className="font-medium text-destructive">Plan yüklenemedi.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
          </ListMessage>
        ) : (
          <ListMessage className="text-center text-sm text-muted-foreground">Bu süzgeçte açık sipariş satırı yok.</ListMessage>
        )}
      </ListBody>
      )}
      {/* [EL-09] sapması devralındı: elle "Daha fazla" (davranış korunarak alt şeride taşındı). */}
      <ListFooter loaded={rows.length}>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla"}
          </Button>
        )}
      </ListFooter>
    </div>
  );
}

function PlanStateChips({ summary, active, onToggle }: { summary?: OrderPlanSummary; active: OrderPlanState[]; onToggle: (s: OrderPlanState | null) => void }) {
  const count: Record<OrderPlanState, number | undefined> = { WHITE: summary?.white, YELLOW: summary?.yellow, GREEN: summary?.green, RED: summary?.red };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Renk süzgeci">
      <Button type="button" size="sm" variant={active.length === 0 ? "default" : "outline"} className="h-8 text-xs" onClick={() => onToggle(null)}>
        Tümü{active.length === 0 && summary ? ` (${summary.lines})` : ""}
      </Button>
      {ORDER_PLAN_STATES.map((s) => (
        <Button key={s} type="button" size="sm" variant={active.includes(s) ? "default" : "outline"} className="h-8 gap-1.5 text-xs" aria-pressed={active.includes(s)} onClick={() => onToggle(s)}>
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT_CLASS[s])} />
          {PLAN_STATE_LABEL[s]}
          {count[s] !== undefined ? ` (${count[s]})` : ""}
        </Button>
      ))}
      {summary && <span className="text-xs text-muted-foreground">Σ {n(summary.quantity)} m</span>}
    </div>
  );
}
