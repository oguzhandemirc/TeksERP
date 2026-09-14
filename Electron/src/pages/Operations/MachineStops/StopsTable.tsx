import { useMemo } from "react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { stopColumns } from "./columns";
import { StopRowMenu, type StopActions } from "./StopRowMenu";
import type { MachineStop } from "./types";

interface Props {
  rows: MachineStop[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  labelOf: (code: string | null) => string;
  nowMs: number;
  actions: StopActions;
}

/** Sayfalama YOK: gün + makine süzgeciyle liste sınırlı (uç 500 tavanı). */
export function StopsTable({ rows, isLoading, isError, onRetry, labelOf, nowMs, actions }: Props) {
  const columns = useMemo(() => stopColumns({ labelOf, nowMs, actions: (r) => <StopRowMenu row={r} a={actions} /> }), [labelOf, nowMs, actions]);
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), enableRowSelection: false });
  return (
    <DataTable<MachineStop>
      table={table}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
      emptyText="Bu süzgeçte duruş yok."
      exportName="Tezgah duruşları"
    />
  );
}
