import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { customerReportsApi, type AliasStats } from "./service";

type TopRow = AliasStats["topCustomers"][number];

const columns: ColumnDef<TopRow>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "itemAliases", header: "Kumaş Alias", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "colorAliases", header: "Renk Alias", cell: ({ getValue }) => fmtInt(getValue() as number) },
  {
    id: "total",
    header: "Toplam",
    accessorFn: (r) => r.itemAliases + r.colorAliases,
    cell: ({ getValue }) => fmtInt(getValue() as number),
  },
];

export function AliasStatsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "customer", "alias-stats"],
    queryFn: () => customerReportsApi.aliasStats(),
    staleTime: 60_000,
  });

  const s = data?.data;
  const rows = s?.topCustomers ?? [];

  return (
    <ReportPageLayout
      title="Alias Eşleştirme"
      description="Müşteri bazlı kumaş/renk takma adlarının kullanım istatistiği."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam Kumaş Alias" value={fmtInt(s?.totalItemAliases ?? 0)} isLoading={isLoading} />
        <MetricCard label="Toplam Renk Alias" value={fmtInt(s?.totalColorAliases ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="Kumaş Alias'lı Müşteri"
          value={fmtInt(s?.customersWithItemAlias ?? 0)}
          isLoading={isLoading}
        />
        <MetricCard
          label="Renk Alias'lı Müşteri"
          value={fmtInt(s?.customersWithColorAlias ?? 0)}
          isLoading={isLoading}
        />
      </div>

      <DetailTable<TopRow>
        title="En Çok Alias Kullanan 50 Müşteri"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
