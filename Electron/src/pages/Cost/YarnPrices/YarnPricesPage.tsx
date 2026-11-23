// =============================================================================
// MALİYET › İPLİK MALİYET FİYATLARI (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Fiyatın yaşı > 90 gün amber (motorun PRICE_STALE eşiği); geçmiş damgalı satırlar çekmecede.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Spool } from "lucide-react";
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
import { yarnPriceColumns } from "./columns";
import { YarnPriceDialog } from "./YarnPriceDialog";
import { YarnPriceHistorySheet } from "./YarnPriceHistorySheet";
import { yarnPriceService, type YarnCostPrice } from "./service";
import { RefreshButton } from "@/components/RefreshButton";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

export function YarnPricesPage({ embedded }: { embedded?: CostEmbedSlots } = {}) {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["cost-yarn-prices", "active", term ?? ""], queryFn: () => yarnPriceService.listActive(term) });
  const [edit, setEdit] = useState<{ row: YarnCostPrice | null } | null>(null);
  const [history, setHistory] = useState<YarnCostPrice | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:yarn-prices", data: rows, columns: useMemo(() => yarnPriceColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <CostPageFrame
      embedded={embedded}
      title="İplik Maliyet Fiyatları"
      description={COST_INPUT_DESCRIPTIONS.yarn}
      showTools={rows.length > 0 || !!term}
      actions={
        <div className="flex gap-2">
          <RefreshButton queryKey={["cost-yarn-prices"]} />
          <PermissionGate permission="cost:write">
            <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Fiyat gir</Button>
          </PermissionGate>
        </div>
      }
      tools={
        <>
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="İplik adı ya da kodu ara" />
          <DataTableTools table={table} compact exportName="İplik fiyatları" />
        </>
      }
    >
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="İplik fiyatları" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="İplik fiyatları" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : term ? (
          <ListMessage className="text-sm text-muted-foreground">Aramaya uyan kayıt yok.</ListMessage>
        ) : (
          <ListMessage>
            <EmptyState icon={Spool} title="Henüz iplik maliyet fiyatı yok" description={'"Fiyat gir" ile çözgü ve atkı ipliklerinin kg fiyatını yazın; fiyatı olmayan iplik maliyette eksik sayılır.'} />
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <YarnPriceDialog open onOpenChange={(o) => !o && setEdit(null)} current={edit.row} />}
      {history && <YarnPriceHistorySheet row={history} onClose={() => setHistory(null)} />}
    </CostPageFrame>
  );
}
