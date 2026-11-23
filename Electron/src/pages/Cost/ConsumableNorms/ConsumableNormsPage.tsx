// =============================================================================
// MALİYET › HİZMET SARF NORMLARI (D4-G1b) — `cost:read` görür, `cost:write` girer/değiştirir/kaldırır.
// Hizmet kalemi × sarf kalemi × metre başı miktar; kârlılıkta "İpe giden" bu normla hesaplanır (sunucuda).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Plus } from "lucide-react";
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
import { normColumns } from "./columns";
import { ConsumableNormDialog } from "./ConsumableNormDialog";
import { ConsumableNormHistorySheet } from "./ConsumableNormHistorySheet";
import { consumableNormService, type ConsumableNorm } from "./service";
import { RefreshButton } from "@/components/RefreshButton";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

export function ConsumableNormsPage({ embedded }: { embedded?: CostEmbedSlots } = {}) {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["cost-consumable-norms", "active", term ?? ""], queryFn: () => consumableNormService.listActive(term) });
  const [edit, setEdit] = useState<{ current: ConsumableNorm | null } | null>(null);
  const [history, setHistory] = useState<ConsumableNorm | null>(null);
  const rows = q.data ?? [];
  const table = useLocalTable({ tableKey: "cost:consumable-norms", data: rows, columns: useMemo(() => normColumns(setEdit, setHistory), []), getRowId: (r) => r.id });
  return (
    <CostPageFrame
      embedded={embedded}
      title="Hizmet Sarf Normları"
      description={COST_INPUT_DESCRIPTIONS.norms}
      showTools={rows.length > 0 || !!term}
      actions={
        <div className="flex gap-2">
          <RefreshButton queryKey={["cost-consumable-norms"]} />
          {/* Kalem seçici /api/items ister (item:read); izinsiz rolde düğme 403'e açılmasın diye birlikte kapılı. */}
          <PermissionGate allOf={["cost:write", "item:read"]}>
            <Button onClick={() => setEdit({ current: null })}><Plus className="mr-1 h-4 w-4" />Norm gir</Button>
          </PermissionGate>
        </div>
      }
      tools={
        <>
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Hizmet ya da sarf adı/kodu ara" />
          <DataTableTools table={table} compact exportName="Sarf normları" />
        </>
      }
    >
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
            <EmptyState icon={Package} title="Henüz sarf normu yok" description="Normu olmayan hizmetin sarfı kârlılıkta görünmez." />
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <ConsumableNormDialog onClose={() => setEdit(null)} current={edit.current} />}
      {history && <ConsumableNormHistorySheet row={history} onClose={() => setHistory(null)} />}
    </CostPageFrame>
  );
}
