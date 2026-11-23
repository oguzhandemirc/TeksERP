import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { ReturnsBadge } from "@/components/operations/ReturnsBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat, formatQty } from "@/lib/format";
import { internalInvoiceOf } from "./invoiceDraftVisibility";
import { DocumentsCell, InvoiceInfoCell, type DispatchRowHandlers } from "./DispatchRowCells";
import type { DispatchListItem } from "./types";
import { loadUnitsText } from "@/lib/load-unit";

/**
 * Sevk Edilenler sütunları (2026-11-19 düzeni): Fatura sütunu yalnız BİLGİ, belge düğmeleri sağa yapışık
 * "Belgeler" sütununda (İrsaliye · Fatura · ⋯). Eskiden Fatura hücresinde no + Düzenle + Faturayı aç
 * yan yana sığmıyordu. Dışa aktarım: her bilgi sütununun `exportValue`'su var, düğme sütunu `noExport`.
 */
export function buildDispatchColumns(h: DispatchRowHandlers): ColumnDef<DispatchListItem>[] {
  return [
    {
      accessorKey: "shipmentNo",
      header: () => <SortableHeader field="shipmentNo" label="Sevkiyat No" />,
      meta: { label: "Sevkiyat No" },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono">{row.original.shipmentNo}</span>
          {row.original.kind === "DIRECT" && (
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "customer",
      header: "Müşteri",
      meta: {
        exportValue: (r) => r.customer.name,
        exportExtras: [{ label: "Şube", value: (r) => r.branch?.name ?? "" }],
      },
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.customer.name}</div>
          {row.original.branch && (
            <div className="truncate text-xs text-muted-foreground">
              {row.original.branch.name}
              {row.original.branch.code && (
                <span className="ml-1 font-mono text-[10px] text-foreground/70">· {row.original.branch.code}</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "dispatchedAt",
      // Liste varsayılan olarak bu kolona göre sıralanır (çıkış günü = muhasebe dönemi; 2026-08-02 denetimi).
      header: () => <SortableHeader field="dispatchedAt" label="Sevk Tarihi" />,
      meta: {
        label: "Sevk Tarihi",
        exportValue: (r) => (r.dispatchedAt ? safeFormat(r.dispatchedAt, "dd.MM.yyyy HH:mm") : ""),
      },
      cell: ({ row }) =>
        row.original.dispatchedAt ? safeFormat(row.original.dispatchedAt, "dd.MM.yyyy HH:mm") : "—",
    },
    {
      id: "counts",
      header: "İçerik",
      size: 188,
      meta: { exportValue: (r) => dispatchContentText(r) },
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <span className="truncate">{dispatchContentText(row.original)}</span>
          <ReturnsBadge count={row.original._count.returns} />
        </span>
      ),
    },
    {
      id: "totals",
      // BRÜT: iade düşülmez, fiş/irsaliye ile birebir (iade rozeti farkı söyler). Dosyada metre ve kg ayrı sayı.
      header: "Metraj / Kg",
      size: 150,
      meta: {
        exportLabel: "Metraj (m)",
        exportValue: (r) => r.totalMeters,
        summable: true,
        align: "left",
        exportExtras: [{ label: "Kg", value: (r) => r.totalKg, summable: true }],
      },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {/* Dosyayla aynı hassasiyet (≤3 hane, upTo3Text ikizi): ekran = Excel = PDF. */}
          {formatQty(row.original.totalMeters)} m
          {row.original.totalKg > 0 && (
            <span className="text-muted-foreground"> · {formatQty(row.original.totalKg)} kg</span>
          )}
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Fatura",
      meta: {
        exportValue: (r) => r.invoiceNo ?? internalInvoiceOf(r)?.docNo ?? "",
        exportExtras: [
          { label: "Fatura Tarihi", value: (r) => (r.invoicedAt ? safeFormat(r.invoicedAt, "dd.MM.yyyy") : "") },
        ],
      },
      cell: ({ row }) => <InvoiceInfoCell row={row.original} h={h} />,
    },
    {
      id: "documents",
      header: "Belgeler",
      size: 248,
      meta: { noExport: true, sticky: "right" },
      cell: ({ row }) => <DocumentsCell row={row.original} h={h} />,
    },
  ];
}

/**
 * "İçerik" hücresi. Doğrudan sevkte çuval yok — top (+ sipariş). Yük birimi dili `loadUnitsText` (Sevkiyatlar listesiyle
 * tek kaynak): dökme/araba yükünde "1 çuval" yazılmaz (prova 2026-11-06). Çuval beyanı varsa ÖNCE fiziksel adet,
 * parantezde sistemin saydığı — fark meşrudur ve bilginin kendisidir.
 */
export function dispatchContentText(r: Pick<DispatchListItem, "kind" | "_count" | "manualSackCount">): string {
  const c = r._count;
  if (r.kind === "DIRECT") return `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`;
  const loose = (c.carts ?? 0) + (c.bulks ?? 0);
  if (r.manualSackCount != null && loose === 0) return `${r.manualSackCount} çuval (${c.sacks} kayıt) · ${c.rolls} top`;
  return `${loadUnitsText(c.sacks, c.carts, c.bulks)} · ${c.rolls} top`;
}
