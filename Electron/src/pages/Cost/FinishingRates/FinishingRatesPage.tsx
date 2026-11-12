// =============================================================================
// MALİYET › FASON / TERBİYE TARİFELERİ (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Tarife bazı HAM ya da MAMUL metre (plan §2.2 iki formül); tipik boy çekmesi yapıda yoksa kullanılır.
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
import { finishingColumns } from "./columns";
import { FinishingRateDialog } from "./FinishingRateDialog";
import { FinishingRateHistorySheet } from "./FinishingRateHistorySheet";
import { finishingRateService, type FinishingRate } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

export function FinishingRatesPage() {
  const q = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: finishingRateService.listActive });
  const [edit, setEdit] = useState<{ row: FinishingRate | null } | null>(null);
  const [history, setHistory] = useState<FinishingRate | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:finishing-rates", data: rows, columns: useMemo(() => finishingColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <PageShell>
      <PageHeader
        title="Fason Tarifeleri"
        description="Terbiye/boya/apre fason ücretleri — kumaşın maliyet yapısı tarifeyi koduyla çağırır. Değişiklik yeni sürümdür."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-finishing-rates"]} />
            <PermissionGate permission="cost:write">
              <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Yeni tarife</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row items-center justify-end">
        <DataTableTools table={table} compact exportName="Terbiye tarifeleri" />
      </ListToolbar>
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
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz tarife yok — ham satılan kumaş için tarife gerekmez; terbiyeye giden kumaş için "Yeni tarife" ile fason ücretini yazın.
            </div>
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <FinishingRateDialog current={edit.row} onClose={() => setEdit(null)} />}
      {history && <FinishingRateHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
