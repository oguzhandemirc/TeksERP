// ATKI KARTLARI listesi (B19) — Tanımlar → Üretim karosu, `dokumaEnabled`. Satır tıklanınca kart düzenleme penceresi açılır;
// atkı alanları ürün penceresiyle aynı (`WeftContentFields`). Süzme sunucuda (arama, pasifler).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { RefreshButton } from "@/components/RefreshButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import type { WeftSpecListRow } from "@/pages/WeaveDesigns/types";
import { WEFT_SPEC_COLUMNS } from "./columns";
import { WEFT_SPECS_QUERY_KEY, WeftSpecFormDialog } from "./WeftSpecFormDialog";

export function WeftSpecsPage() {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("warpspec:write");
  // `?search=<kod>`: kullanım yerinden (ürün penceresi, desen kartı) "Atkı Kartları ekranında aç" kartı süzülü açar.
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<WeftSpecListRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const list = useQuery({
    queryKey: [WEFT_SPECS_QUERY_KEY, "list", q, includeInactive],
    queryFn: () => weftSpecApi.list({ search: q || undefined, includeInactive }),
  });
  const rows = list.data ?? [];
  const table = useLocalTable({ tableKey: "weft-specs", data: rows, columns: WEFT_SPEC_COLUMNS, getRowId: (r) => r.id });
  const openForm = (row: WeftSpecListRow | null) => {
    setEditing(row);
    setFormOpen(true);
  };
  return (
    <PageShell>
      <PageHeader
        title="Atkı Kartları"
        description="Atkı iplikleri · atkı sırası · sıklık · program no. Bir atkı kartı birden çok kumaşı besler; kumaşa ürün penceresinin Atkı sekmesinden bağlanır."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton queryKey={WEFT_SPECS_QUERY_KEY} />
            {canWrite && (
              <Button size="sm" onClick={() => openForm(null)}><Plus className="mr-1 h-4 w-4" />Yeni atkı kartı</Button>
            )}
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Atkı kartı kodu veya adı ara" />
        <ToolbarToggle checked={includeInactive} onCheckedChange={setIncludeInactive} label="Pasifleri göster" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Atkı kartları" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        onRowClick={(r) => openForm(r)}
        exportName="Atkı kartları"
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        emptyText={q ? "Aramaya uyan atkı kartı yok." : "Henüz atkı kartı yok. Ürün penceresinde atkı girince ya da \"Yeni atkı kartı\" ile açılır."}
      />
      <ListFooter loaded={rows.length} />
      <WeftSpecFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} canWrite={canWrite} />
    </PageShell>
  );
}
