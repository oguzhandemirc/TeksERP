import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { fmtInt, fmtMeters } from "../_components/formatters";
import { inventoryReportsApi, type CustomerOwnedRow } from "./service";

const columns: ColumnDef<CustomerOwnedRow>[] = [
  { accessorKey: "customerCode", header: "Kod" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "rollCount", header: "Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "totalQty", header: "Metraj", cell: ({ getValue }) => fmtMeters(getValue() as number) },
];

export function CustomerOwnedPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "inventory", "customer-owned"],
    queryFn: () => inventoryReportsApi.customerOwned(),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalRolls = rows.reduce((a, r) => a + r.rollCount, 0);
  const totalQty = rows.reduce((a, r) => a + r.totalQty, 0);

  return (
    <ReportPageLayout
      title="Müşteri Mülkü Stok"
      description="Tesiste bulunan, ownerCustomerId dolu (servis üretimi) ruloları."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Müşteri Sayısı" value={fmtInt(rows.length)} isLoading={isLoading} />
        <MetricCard label="Toplam Rulo" value={fmtInt(totalRolls)} isLoading={isLoading} />
        <MetricCard label="Toplam Metraj" value={fmtMeters(totalQty)} isLoading={isLoading} />
      </div>

      <DetailTable<CustomerOwnedRow>
        data={rows}
        columns={columns}
        isLoading={isLoading}
        emptyLabel="Müşteri mülkü stok yok."
      />
    </ReportPageLayout>
  );
}
