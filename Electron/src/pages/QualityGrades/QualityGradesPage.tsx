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
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<QualityGrade>({
    queryKey: "quality-grades",
    fetchFn: qualityGradeService.listCursor,
    columns: qualityGradeColumns,
    forceFilters: { isActive: "true" },
    // Salt okunur liste: toplu işlem yok → seçim kutusu ve "toplu işlem için seçin" şeridi de yok.
    enableSelection: false,
  });

  return (
    <PageShell>
      <PageHeader
        title="Kalite Sınıfları"
        titleExtra={<Lock className="h-4 w-4 text-muted-foreground" aria-label="Salt okunur" />}
        description="Kalite sınıfları sistemle birlikte gelir; bu ekrandan eklenemez, değiştirilemez ya da silinemez. Yeni kalite kademesi veya hedef değişikliği için destek ekibine başvurun."
        actions={<RefreshButton queryKey="quality-grades" />}
      />

      <DataTableToolbar
        table={table}
        fetchAll={fetchAll}
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
