import { Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { qualityGradeColumns } from "./columns";
import { qualityGradeService } from "./service";
import type { QualityGrade } from "./types";

export function QualityGradesPage() {
  const { table, query, search, setSearch, pagination } = useDataTable<QualityGrade>({
    queryKey: "quality-grades",
    fetchFn: qualityGradeService.listCursor,
    columns: qualityGradeColumns,
    forceFilters: { isActive: "true" },
  });

  return (
    <PageShell>
      <PageHeader
        title="Kalite Sınıfları"
        actions={<RefreshButton queryKey="quality-grades" />}
      />

      <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Bu liste seed dosyasından yönetilir; UI üzerinden ekle / değiştir / sil yapılamaz. Yeni kalite kademesi veya hedef değişimi geliştirici işidir.
        </span>
      </div>

      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Kod veya ad ara..."
      />

      <DataTable<QualityGrade>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Kayıt yok."
      />
    </PageShell>
  );
}
