// =============================================================================
// SİPARİŞLER › ÜRETİM PLANI SEKMESİ (SY-K2; tasarım §12.5 madde 3) — YENİ MENÜ YOK
// =============================================================================
// Kolonlar fabrikanın plan görselinin sırasıyla: tarih · desen · varyant · metre · en · müşteri · fiyat ·
// kuşak · top boyu · not. Satır rengi SUNUCUDAN (`orderLineProductionState`); istemci renk hesaplamaz.
// Renk süzgeci URL'de (`planState`) → kayıtlı görünüm altyapısı (`SavedViewsMenu`, URL anlığı) saklar.
// =============================================================================
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { fmtCalendarDay, fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { getOrderPlan, parsePlanStates, PLAN_STATE_LABEL, ORDER_PLAN_STATES, type OrderPlanRow, type OrderPlanState, type OrderPlanSummary } from "./orderPlanService";

export const ORDER_PLAN_QUERY_KEY = "order-plan";
const PAGE = 100;

/** Renk → satır/rozet sınıfı (renk SUNUCUDAN gelir; burada yalnız görünüm). */
export const PLAN_STATE_CLASS: Record<OrderPlanState, string> = {
  WHITE: "bg-background",
  YELLOW: "bg-amber-50 dark:bg-amber-950/30",
  GREEN: "bg-emerald-50 dark:bg-emerald-950/30",
  RED: "bg-red-50 dark:bg-red-950/30",
};
const DOT_CLASS: Record<OrderPlanState, string> = {
  WHITE: "border border-muted-foreground/50 bg-background",
  YELLOW: "bg-amber-400",
  GREEN: "bg-emerald-500",
  RED: "bg-red-500",
};

const n = (v: number | null, digits = 1) => (v === null ? "—" : v.toLocaleString("tr-TR", { maximumFractionDigits: digits }));

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 pb-3" data-testid="order-plan-view">
      <div className="flex flex-wrap items-center gap-2">
        <PlanStateChips summary={summary} active={states} onToggle={toggleState} />
        <div className="ml-auto">
          <SavedViewsMenu />
        </div>
      </div>
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : q.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p className="font-medium text-destructive">Plan yüklenemedi.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Bu süzgeçte açık sipariş satırı yok.</div>
      ) : (
        <PlanTable rows={rows} pricingEnabled={pricingEnabled} />
      )}
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla"}
          </Button>
        </div>
      )}
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

function PlanTable({ rows, pricingEnabled }: { rows: OrderPlanRow[]; pricingEnabled: boolean }) {
  const heads = ["", "Tarih", "Termin", "Desen", "Varyant", "Metre", "En", "Müşteri", ...(pricingEnabled ? ["Fiyat"] : []), "Kuşak", "Top boyu", "Not", "Sipariş"];
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>{heads.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lineId} className={cn("border-t", PLAN_STATE_CLASS[r.state])} data-state={r.state} data-testid="order-plan-row">
              <td className="px-2 py-1.5" title={PLAN_STATE_LABEL[r.state]}>
                <span className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT_CLASS[r.state])} aria-label={PLAN_STATE_LABEL[r.state]} />
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtFactoryDate(r.orderDate)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{fmtCalendarDay(r.deadline)}</td>
              <td className="px-2 py-1.5">{r.item.code} <span className="text-muted-foreground">{r.item.name}</span></td>
              <td className="px-2 py-1.5">{r.recipe ? (r.recipe.variantCode ?? r.recipe.code) : "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{n(r.quantity)} {r.unit === "MT" ? "" : r.unit}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{n(r.width)}</td>
              <td className="px-2 py-1.5">{r.customer.code ?? r.customer.name}</td>
              {pricingEnabled && <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.unitPrice === null ? "—" : `${n(r.unitPrice, 2)} ${r.currency}`}</td>}
              <td className="px-2 py-1.5">{r.targetValues.length > 0 ? r.targetValues.map((t) => t.valueName).join(", ") : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{n(r.pieceLengthM)}</td>
              <td className="max-w-[16rem] truncate px-2 py-1.5" title={r.cutNote ?? undefined}>{r.cutNote ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{r.orderNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
