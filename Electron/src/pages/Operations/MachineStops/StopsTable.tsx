import { useMemo } from "react";
import type { Table } from "@tanstack/react-table";
import { useLocalTable } from "@/hooks/useLocalTable";
import { DataTable } from "@/components/data-table/DataTable";
import { stopColumns } from "./columns";
import { StopRowMenu, type StopActions } from "./StopRowMenu";
import type { MachineStop } from "./types";

interface Props {
  table: Table<MachineStop>;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** "Tezgah" (dokuma) | "Makine" (dokumasız rejim). */
  noun?: string;
}

interface TableArgs {
  rows: MachineStop[];
  labelOf: (code: string | null) => string;
  nowMs: number;
  actions: StopActions;
  noun: string;
}

/** Tablo örneği sayfada kurulur: standart "Sütunlar" menüsü süzgeç şeridinin sağ ucunda durur. */
export function useStopsTable({ rows, labelOf, nowMs, actions, noun }: TableArgs) {
  const columns = useMemo(
    () => stopColumns({ labelOf, nowMs, actions: (r) => <StopRowMenu row={r} a={actions} />, noun }),
    [labelOf, nowMs, actions, noun],
  );
  return useLocalTable({ tableKey: "machine-stops", data: rows, columns });
}

/** Sayfalama YOK: gün + makine süzgeciyle liste sınırlı (uç 500 tavanı). */
export function StopsTable({ table, isLoading, isError, onRetry, noun = "Tezgah" }: Props) {
  return (
    <DataTable<MachineStop>
      table={table}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      errorText="Bu bir “kayıt yok” cevabı DEĞİLDİR — istek reddedildi ya da sunucuya ulaşamadı (modül kapalı, yetki yok, ağ)."
      emptyText="Bu süzgeçte duruş yok."
      exportName={`${noun} duruşları`}
    />
  );
}
