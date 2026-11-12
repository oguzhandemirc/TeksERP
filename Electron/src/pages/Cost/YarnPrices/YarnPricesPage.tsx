// =============================================================================
// MALİYET › İPLİK MALİYET FİYATLARI (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Fiyatın yaşı > 90 gün amber (motorun PRICE_STALE eşiği); geçmiş damgalı satırlar çekmecede.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { CostQueryError } from "../shared/CostQueryState";
import { yarnPriceColumns } from "./columns";
import { YarnPriceDialog } from "./YarnPriceDialog";
import { YarnPriceHistorySheet } from "./YarnPriceHistorySheet";
import { yarnPriceService, type YarnCostPrice } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

export function YarnPricesPage() {
  const q = useQuery({ queryKey: ["cost-yarn-prices", "active"], queryFn: yarnPriceService.listActive });
  const [edit, setEdit] = useState<{ row: YarnCostPrice | null } | null>(null);
  const [history, setHistory] = useState<YarnCostPrice | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:yarn-prices", data: rows, columns: useMemo(() => yarnPriceColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <PageShell>
      <PageHeader
        title="İplik Maliyet Fiyatları"
        description="Maliyet hesabında kullanılan kg fiyatı. Değişiklik yeni satır yazar, eski fiyat damgalı kalır; kayıtlı standart maliyetler değişmez."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-yarn-prices"]} />
            <PermissionGate permission="cost:write">
              <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Fiyat gir</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row items-center justify-end">
        <DataTableTools table={table} compact exportName="İplik fiyatları" />
      </ListToolbar>
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
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz iplik maliyet fiyatı yok — "Fiyat gir" ile çözgü ve atkı ipliklerinin kg fiyatını yazın; fiyatı olmayan iplik maliyette eksik sayılır.
            </div>
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <YarnPriceDialog open onOpenChange={(o) => !o && setEdit(null)} current={edit.row} />}
      {history && <YarnPriceHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
