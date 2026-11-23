// =============================================================================
// MALİYET › FASON / TERBİYE TARİFELERİ (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Tarife bazı HAM ya da MAMUL metre (plan §2.2 iki formül); tipik boy çekmesi yapıda yoksa kullanılır.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CostQueryError } from "../shared/CostQueryState";
import { CostPageFrame, type CostEmbedSlots } from "../shared/CostPageFrame";
import { COST_INPUT_DESCRIPTIONS } from "../InputPrices/tabs-config";
import { finishingColumns } from "./columns";
import { FinishingRateDialog } from "./FinishingRateDialog";
import { FinishingRateHistorySheet } from "./FinishingRateHistorySheet";
import { finishingRateService, type FinishingRate } from "./service";
import { RefreshButton } from "@/components/RefreshButton";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

export function FinishingRatesPage({ embedded }: { embedded?: CostEmbedSlots } = {}) {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["cost-finishing-rates", "active", term ?? ""], queryFn: () => finishingRateService.listActive(term) });
  const [edit, setEdit] = useState<{ row: FinishingRate | null } | null>(null);
  const [history, setHistory] = useState<FinishingRate | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:finishing-rates", data: rows, columns: useMemo(() => finishingColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <CostPageFrame
      embedded={embedded}
      title="Fason Tarifeleri"
      description={COST_INPUT_DESCRIPTIONS.finishing}
      showTools={rows.length > 0 || !!term}
      actions={
        <div className="flex gap-2">
          <RefreshButton queryKey={["cost-finishing-rates"]} />
          <PermissionGate permission="cost:write">
            <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Yeni tarife</Button>
          </PermissionGate>
        </div>
      }
      tools={
        <>
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Tarife kodu/adı ya da fason firma ara" />
          <DataTableTools table={table} compact exportName="Terbiye tarifeleri" />
        </>
      }
    >
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Terbiye tarifeleri" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Tarifeler" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : term ? (
          <ListMessage className="text-sm text-muted-foreground">Aramaya uyan kayıt yok.</ListMessage>
        ) : (
          <ListMessage>
            <EmptyState icon={Factory} title="Henüz tarife yok" description={'Ham satılan kumaş için tarife gerekmez; terbiyeye giden kumaş için "Yeni tarife" ile fason ücretini yazın.'} />
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <FinishingRateDialog current={edit.row} onClose={() => setEdit(null)} />}
      {history && <FinishingRateHistorySheet row={history} onClose={() => setHistory(null)} />}
    </CostPageFrame>
  );
}
