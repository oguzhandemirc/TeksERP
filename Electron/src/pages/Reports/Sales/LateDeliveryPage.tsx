import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtMeters } from "../_components/formatters";
import { salesReportsApi, type LateDeliveryRow } from "./service";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
};

const columns: ColumnDef<LateDeliveryRow>[] = [
  { accessorKey: "orderNumber", header: "Sipariş No" },
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ getValue }) => {
      const s = String(getValue() ?? "");
      return <Badge variant="outline">{STATUS_LABEL[s] ?? s}</Badge>;
    },
  },
  { accessorKey: "deadline", header: "Termin", cell: ({ getValue }) => fmtDate(getValue() as string) },
  {
    accessorKey: "daysLate",
    header: "Gecikme (gün)",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={v >= 7 ? "font-semibold text-destructive" : ""}>{fmtInt(v)}</span>;
    },
  },
  { accessorKey: "plannedQty", header: "Planlanan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "shippedQty", header: "Sevk Edilen", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "remainingQty", header: "Kalan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
];

export function LateDeliveryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "sales", "late-delivery"],
    queryFn: () => salesReportsApi.lateDeliveries(),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const totalCount = rows.length;
  const over7Days = rows.filter((r) => r.daysLate >= 7).length;
  const totalRemaining = rows.reduce((acc, r) => acc + r.remainingQty, 0);

  return (
    <ReportPageLayout
      title="Geç Teslimat"
      description="Bugün itibariyle termini geçmiş açık siparişler — anlık görüntü."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Geciken Sipariş"
          value={fmtInt(totalCount)}
          tone={totalCount > 0 ? "bad" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard
          label="7+ Gün Geciken"
          value={fmtInt(over7Days)}
          tone={over7Days > 0 ? "bad" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard label="Toplam Kalan Metraj" value={fmtMeters(totalRemaining)} isLoading={isLoading} />
      </div>

      <DetailTable<LateDeliveryRow>
        data={rows}
        columns={columns}
        isLoading={isLoading}
        emptyLabel="Şu an geciken sipariş yok."
      />
    </ReportPageLayout>
  );
}
