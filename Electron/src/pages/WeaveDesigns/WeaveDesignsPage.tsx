// DESEN KARTLARI listesi (Seyitoğlu SY-A3, tasarım §2.8) — Tanımlar → Üretim karosu, `dokumaEnabled`.
// Liste armür ızgarasını taşımaz (sunucu süzer); satır tıklanınca kart sayfası açılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { RefreshButton } from "@/components/RefreshButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
        description="Örgü türü · armür planı · atkı sırası · varyantlar. Bir desen birden çok kumaşı besler."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton queryKey={WEAVE_DESIGNS_QUERY_KEY} />
            {hasPermission("warpspec:write") && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />Yeni desen</Button>
            )}
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center gap-3">
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ara…" title="Desen kodu veya adı ara" aria-label="Desen ara" />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} aria-label="Pasifleri göster" />
          Pasifleri göster
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Desen kartları" />
        </div>
      </ListToolbar>
      {!list.isLoading && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => nav(`/definitions/weave-designs/${r.id}`)} exportName="Desen kartları" />
      ) : (
      <ListBody>
        {list.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : (
          <ListMessage className="text-sm text-muted-foreground">{q ? "Aramaya uyan desen yok." : "Henüz desen kartı yok."}</ListMessage>
        )}
      </ListBody>
      )}
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
