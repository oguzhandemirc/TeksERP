// =============================================================================
// MALİYET › HİZMET SARF NORMLARI (D4-G1b) — `cost:read` görür, `cost:write` girer/değiştirir/kaldırır.
// Hizmet kalemi × sarf kalemi × metre başı miktar; kârlılıkta "İpe giden" bu normla hesaplanır (sunucuda).
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
import { normColumns } from "./columns";
import { ConsumableNormDialog } from "./ConsumableNormDialog";
import { ConsumableNormHistorySheet } from "./ConsumableNormHistorySheet";
import { consumableNormService, type ConsumableNorm } from "./service";
import { RefreshButton } from "@/components/RefreshButton";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

export function ConsumableNormsPage() {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["cost-consumable-norms", "active", term ?? ""], queryFn: () => consumableNormService.listActive(term) });
  const [edit, setEdit] = useState<{ current: ConsumableNorm | null } | null>(null);
  const [history, setHistory] = useState<ConsumableNorm | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:consumable-norms", data: rows, columns: useMemo(() => normColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <PageShell>
      <PageHeader
        title="Hizmet Sarf Normları"
        description="Bir hizmetin metresi için harcanan sarf (ip, kurşun…). Değişiklik şu andan itibaren geçerli yeni sürümdür; eski norm damgalı kalır."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-consumable-norms"]} />
            {/* Kalem seçici /api/items ister (item:read); izinsiz rolde düğme 403'e açılmasın diye birlikte kapılı. */}
            <PermissionGate allOf={["cost:write", "item:read"]}>
              <Button onClick={() => setEdit({ current: null })}><Plus className="mr-1 h-4 w-4" />Norm gir</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row items-center justify-end gap-1.5">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Hizmet ya da sarf adı/kodu ara" />
        <DataTableTools table={table} compact exportName="Sarf normları" />
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Sarf normları" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Sarf normları" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : term ? (
          <ListMessage className="text-sm text-muted-foreground">Aramaya uyan kayıt yok.</ListMessage>
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz sarf normu yok — normu olmayan hizmetin sarfı kârlılıkta görünmez.
            </div>
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <ConsumableNormDialog onClose={() => setEdit(null)} current={edit.current} />}
      {history && <ConsumableNormHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
