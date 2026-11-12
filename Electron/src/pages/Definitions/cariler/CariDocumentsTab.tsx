// Cari kayıt sayfası — "Belgeler" sekmesi. Satırlar sunucudan sayfalı (en yeni önce); sıralama/süzme yok.
// Basılı belge mevcut görüntüleyicide (`PrintedDocDialog`, yalnız görüntüle/bas — revizyon kaynak ekranında), gelen belge kendi sayfasında açılır.
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { useLocalTable } from "@/hooks/useLocalTable";
import { formatFactory } from "@/lib/factory-time";
import type { PrintedDocType } from "@/services/printedDocumentService";
import { cariDocLabel, cariDocStatus, cariDocumentsQuery, incomingNotePath, type CariDocumentRow } from "./cari-documents";

const COLUMNS: ColumnDef<CariDocumentRow>[] = [
  { id: "type", header: "Tür", enableSorting: false, meta: { exportValue: (r: CariDocumentRow) => cariDocLabel(r.docType) }, cell: ({ row }) => <Badge variant="outline">{cariDocLabel(row.original.docType)}</Badge> },
  { id: "no", header: "Belge no", enableSorting: false, meta: { exportValue: (r: CariDocumentRow) => r.documentNo }, cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.documentNo}</span> },
  { id: "date", header: "Tarih", enableSorting: false, meta: { exportValue: (r: CariDocumentRow) => formatFactory(r.date, "dd.MM.yyyy HH:mm") }, cell: ({ row }) => formatFactory(row.original.date, "dd.MM.yyyy HH:mm") },
  {
    id: "status",
    header: "Durum",
    enableSorting: false,
    meta: { exportValue: (r: CariDocumentRow) => cariDocStatus(r).label },
    cell: ({ row }) => {
      const s = cariDocStatus(row.original);
      return <Badge variant={s.variant}>{s.label}</Badge>;
    },
  },
  { id: "version", header: "Sürüm", enableSorting: false, meta: { exportValue: (r: CariDocumentRow) => (r.version != null ? `v${r.version}` : "") }, cell: ({ row }) => (row.original.version != null ? `v${row.original.version}` : "—") },
];

export function CariDocumentsTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const q = useInfiniteQuery(cariDocumentsQuery(customerId));
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const table = useLocalTable({ tableKey: "cari:documents", data: rows, columns: COLUMNS, getRowId: (r) => r.id });
  const [preview, setPreview] = useState<CariDocumentRow | null>(null);
  const total = q.data?.pages[0]?.pagination.total ?? 0;
  const open = (r: CariDocumentRow) => (r.kind === "incoming" ? navigate(incomingNotePath(r.target.id)) : setPreview(r));

  return (
    <SectionCard title="Belgeler" description={`${total} belge · en yeni önce`} action={<DataTableTools table={table} hideExport />} flush>
      {q.isLoading ? (
        <div className="space-y-2 px-5 pb-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : q.isError ? (
        <div className="flex items-center gap-3 px-5 pb-4 text-sm text-muted-foreground">
          Belgeler alınamadı.
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Tekrar dene</Button>
        </div>
      ) : (
        <DataTable
          table={table}
          onRowClick={open}
          loadMore={{ hasMore: q.hasNextPage, isFetchingMore: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() }}
        />
      )}
      <PrintedDocDialog
        docType={(preview?.docType ?? "SHIPMENT_DISPATCH") as PrintedDocType}
        sourceId={preview?.kind === "printed" ? preview.sourceId : null}
        open={preview?.kind === "printed"}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
        title={preview ? cariDocLabel(preview.docType) : "Belge"}
        description={preview?.documentNo}
      />
    </SectionCard>
  );
}
