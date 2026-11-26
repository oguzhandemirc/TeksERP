// DESEN KARTLARI listesi (Seyitoğlu SY-A3, tasarım §2.8) — Tanımlar → Üretim karosu, `dokumaEnabled`.
// Liste armür ızgarasını taşımaz (sunucu süzer); satır tıklanınca kart sayfası açılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
import { WeaveDesignCreateDialog } from "./WeaveDesignCreateDialog";
import { weaveDesignApi } from "./service";
import { WEAVE_DESIGN_COLUMNS } from "./columns";

export const WEAVE_DESIGNS_QUERY_KEY = "weave-designs";

export function WeaveDesignsPage() {
  const nav = useNavigate();
  const { hasPermission } = useRoleAccess();
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const list = useQuery({
    queryKey: [WEAVE_DESIGNS_QUERY_KEY, "list", q, includeInactive],
    queryFn: () => weaveDesignApi.list({ search: q || undefined, includeInactive }),
  });
  const rows = list.data ?? [];
  const table = useLocalTable({ tableKey: "weave-designs", data: rows, columns: WEAVE_DESIGN_COLUMNS, getRowId: (r) => r.id });
  return (
    <PageShell>
      <PageHeader
        title="Desen Kartları"
        description="Örgü türü · desen örgüsü · atkı raporu · varyantlar. Bir desen birden çok kumaşı besler."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton queryKey={WEAVE_DESIGNS_QUERY_KEY} />
            {hasPermission("warpspec:write") && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni desen</Button>
            )}
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Desen kodu veya adı ara" />
        <ToolbarToggle checked={includeInactive} onCheckedChange={setIncludeInactive} label="Pasifleri göster" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Desen kartları" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        onRowClick={(r) => nav(`/definitions/weave-designs/${r.id}`)}
        exportName="Desen kartları"
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        emptyText={q ? "Aramaya uyan desen yok." : "Henüz desen kartı yok."}
      />
      <ListFooter loaded={rows.length} />
      {createOpen && (
        <WeaveDesignCreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => nav(`/definitions/weave-designs/${id}`)}
        />
      )}
    </PageShell>
  );
}
