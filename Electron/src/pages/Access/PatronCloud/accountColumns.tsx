// Bulut hesapları — ortak DataTable sütunları; AKTIF hesapta satır sonunda "Kilitle".
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalTable } from "@/hooks/useLocalTable";
import { ACCOUNT_STATE_LABELS, stamp } from "./labels";
import type { CloudAccount } from "./service";

function accountColumns(onLock: (h: CloudAccount) => void, busy: boolean): ColumnDef<CloudAccount>[] {
  return [
    { accessorKey: "ad", header: "Ad", meta: { label: "Ad" } },
    { id: "eposta", header: "E-posta", meta: { label: "E-posta", exportValue: (h) => h.eposta ?? "" }, cell: ({ row }) => row.original.eposta ?? "—" },
    { id: "durum", header: "Durum", meta: { label: "Durum", exportValue: (h) => ACCOUNT_STATE_LABELS[h.durum] }, cell: ({ row }) => ACCOUNT_STATE_LABELS[row.original.durum] },
    { id: "sonGiris", header: "Son giriş", meta: { label: "Son giriş", exportValue: (h) => stamp(h.sonGiris) }, cell: ({ row }) => stamp(row.original.sonGiris) },
    {
      id: "actions",
      header: "",
      size: 112,
      enableSorting: false,
      meta: { align: "right" },
      cell: ({ row: { original: h } }) =>
        h.durum === "AKTIF" ? (
          <Button size="sm" variant="outline" onClick={() => onLock(h)} disabled={busy}>
            <Lock className="mr-1 h-3.5 w-3.5" /> Kilitle
          </Button>
        ) : null,
    },
  ];
}

export function useCloudAccountsTable(accounts: CloudAccount[], onLock: (h: CloudAccount) => void, busy: boolean) {
  const columns = useMemo(() => accountColumns(onLock, busy), [onLock, busy]);
  return useLocalTable({ tableKey: "patron-cloud:accounts", data: accounts, columns });
}
