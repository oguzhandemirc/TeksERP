import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtNum } from "../_components/formatters";
import { batchTraceApi, buildBatchTraceExport, type BatchTrace } from "./batchTrace";

type CustomerRow = BatchTrace["customers"][number];

const customerColumns: ColumnDef<CustomerRow, unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {fmtNum(row.original.qty)} m
        <div className="text-[10px] font-normal text-muted-foreground">
          {fmtInt(row.original.rollCount)} top · {fmtInt(row.original.shipmentCount)} sevkiyat
        </div>
      </div>
    ),
  },
  {
    accessorKey: "lastDispatchedAt",
    header: "Son sevk",
    cell: ({ getValue }) => fmtDate(getValue() as string | null),
  },
];

const returnColumns: ColumnDef<BatchTrace["returns"][number], unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
  { accessorKey: "reason", header: "Neden" },
  { accessorKey: "createdAt", header: "Tarih", cell: ({ getValue }) => fmtDate(getValue() as string) },
];

const fasonColumns: ColumnDef<BatchTrace["subcontractorDispatches"][number], unknown>[] = [
  { accessorKey: "dispatchNo", header: "Sevk No" },
  { accessorKey: "subcontractorName", header: "Fason firma" },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
  { accessorKey: "dispatchedAt", header: "Tarih", cell: ({ getValue }) => fmtDate(getValue() as string) },
  {
    accessorKey: "cancelled",
    header: "Durum",
    cell: ({ getValue }) =>
      (getValue() as boolean) ? <Badge variant="destructive">İPTAL</Badge> : <span className="text-muted-foreground">Geçerli</span>,
  },
];

const statusColumns: ColumnDef<BatchTrace["byStatus"][number], unknown>[] = [
  { accessorKey: "status", header: "Durum" },
  {
    accessorKey: "count",
    header: () => <div className="text-right">Top</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
];

export function BatchTracePage() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ["reports", "production", "batch-search", query],
    queryFn: () => batchTraceApi.search(query),
    enabled: query.trim().length > 0,
    staleTime: 30_000,
  });

  const trace = useQuery({
    queryKey: ["reports", "production", "batch-trace", batchId],
    queryFn: () => batchTraceApi.trace(batchId as string),
    enabled: Boolean(batchId),
    staleTime: 30_000,
  });

  const t = trace.data;
  const spec = useMemo(() => () => (t ? buildBatchTraceExport(t) : null), [t]);
  const candidates = search.data ?? [];

  return (
    <ReportPageLayout
      title="Parti İzleme"
      description="Bu partiden hangi müşteriye ne gitti — şikâyet geldiğinde etki kümesini bulma aracı."
      showDateRange={false}
      actions={<ReportExportBar disabled={!t} buildSpec={spec} />}
    >
      <Card className="p-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBatchId(null);
            setQuery(term);
          }}
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Parti no (örn. P46) veya top barkodu"
            className="h-8 w-[280px] text-sm"
          />
          <Button type="submit" size="sm" disabled={!term.trim()}>
            Ara
          </Button>
          <span className="text-xs text-muted-foreground">
            Parti numarası benzersiz değildir — arama daima aday listesi döner.
          </span>
        </form>

        {query && !search.isLoading && candidates.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Eşleşen parti bulunamadı.</p>
        ) : null}

        {candidates.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button
                key={c.batchId}
                type="button"
                onClick={() => setBatchId(c.batchId)}
                className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                  batchId === c.batchId ? "border-primary bg-accent" : ""
                }`}
              >
                <span className="font-medium">{c.batchNumber}</span>
                {c.merged ? <Badge variant="outline" className="ml-1.5 text-[10px]">birleştirildi</Badge> : null}
                <div className="text-[10px] text-muted-foreground">
                  {c.workOrderNumber ?? "iş emri yok"} · {fmtDate(c.createdAt)} · {fmtInt(c.rollCount)} top
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {t ? (
        <>
          {/* Numaranın benzersiz olmadığı ekranda da yazılı: aksi halde kullanıcı
              seçtiği adayın "o parti" olduğundan emin olmadan rapor okur. */}
          <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{t.batch.batchNumber}</strong> ·{" "}
              {t.batch.workOrderNumber ? `İş Emri ${t.batch.workOrderNumber}` : "iş emri bağı yok"} ·{" "}
              {fmtDate(t.batch.createdAt)}. Parti numarası benzersiz değildir; bu döküm{" "}
              <strong>seçtiğiniz partiye</strong> aittir.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Partideki top" value={fmtInt(t.totals.rollCount)} />
            <MetricCard label="Toplam metraj" value={`${fmtNum(t.totals.qty)} m`} />
            <MetricCard
              label="Ulaştığı müşteri"
              value={fmtInt(t.customers.length)}
              hint="İade edilenler dahil"
            />
            <MetricCard
              label="İade"
              value={fmtInt(t.returns.length)}
              tone={t.returns.length > 0 ? "warn" : "neutral"}
            />
          </div>

          <DetailTable
            title="Bu partiden kime ne gitti"
            description="İade edilmiş mal da listede — iade sevkiyat bağını kopardığı için canlı sorguda görünmezdi."
            data={t.customers}
            columns={customerColumns}
            emptyLabel="Bu parti henüz hiçbir müşteriye sevk edilmemiş"
          />
          <DetailTable title="Durum dağılımı" data={t.byStatus} columns={statusColumns} emptyLabel="Partide top yok" />
          <DetailTable title="İadeler" data={t.returns} columns={returnColumns} emptyLabel="Bu partiden iade alınmamış" />
          <DetailTable
            title="Fason sevkleri"
            data={t.subcontractorDispatches}
            columns={fasonColumns}
            emptyLabel="Bu parti fasona gönderilmemiş"
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
