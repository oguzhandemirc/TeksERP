// Buluttan gelenler — makbuz listesi (salt okunur): kim, ne, sonuç, belge no; ortak DataTable sütunları.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
import { RECEIPT_KIND_LABELS, RECEIPT_OUTCOME_LABELS, stamp } from "./labels";
import type { InboxReceiptRow } from "./service";

const COLUMNS: ColumnDef<InboxReceiptRow>[] = [
  { id: "at", accessorKey: "at", header: "Zaman", meta: { label: "Zaman", exportValue: (r) => stamp(r.at) }, cell: ({ row }) => stamp(row.original.at) },
  { id: "tur", header: "Tür", meta: { label: "Tür", exportValue: (r) => RECEIPT_KIND_LABELS[r.tur] }, cell: ({ row }) => RECEIPT_KIND_LABELS[row.original.tur] },
  { accessorKey: "hesapAdi", header: "Bulut hesabı", meta: { label: "Bulut hesabı" } },
  { id: "belgeNo", header: "Belge no", meta: { label: "Belge no", exportValue: (r) => r.belgeNo ?? "" }, cell: ({ row }) => row.original.belgeNo ?? "—" },
  {
    id: "sonuc",
    header: "Sonuç",
    meta: { label: "Sonuç", exportValue: (r) => RECEIPT_OUTCOME_LABELS[r.sonuc] },
    cell: ({ row }) => (
      <Badge variant={row.original.sonuc === "ISLENDI" ? "default" : "secondary"}>{RECEIPT_OUTCOME_LABELS[row.original.sonuc]}</Badge>
    ),
  },
  {
    id: "mesaj",
    header: "Açıklama",
    meta: { label: "Açıklama", exportValue: (r) => r.mesaj ?? "" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.mesaj ?? "—"}</span>,
  },
];

export function useInboxReceiptsTable(rows: InboxReceiptRow[]) {
  const columns = useMemo(() => COLUMNS, []);
  return useLocalTable({ tableKey: "patron-cloud:receipts", data: rows, columns });
}
