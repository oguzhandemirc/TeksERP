// Bekleyen Kabul — kartela firmasındaki (AT_KARTELA) toplar, sevke göre gruplu. Liste tek istekte gelir
// (`/outstanding`, sunucu tavanı 2000) → arama istemcide (EL-15), tabletle aynı alanlarda.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PackageCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { PermissionGate } from "@/components/PermissionGate";
import { useLocalTable } from "@/hooks/useLocalTable";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatFactory } from "@/lib/factory-time";
import { kartelaService } from "./service";
import { filterJobs, groupOutstanding, type KartelaJob } from "./kartelaActions";
import { KartelaReceiveDialog } from "./KartelaReceiveDialog";

const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 1, useGrouping: false });
const SEARCH_HINT = "Firma, sevk no, kumaş, renk ya da top barkodu";
const goodsText = (j: KartelaJob) =>
  ([j.itemNames[0], j.colorNames[0]].filter(Boolean).join(" · ") || "—") + (j.itemNames.length > 1 ? ` (+${j.itemNames.length - 1} kumaş)` : "");

const JOB_COLUMNS: ColumnDef<KartelaJob>[] = [
  { id: "dispatchNo", header: "Sevk No", meta: { label: "Sevk No" }, accessorFn: (j) => j.dispatchNo, cell: ({ row }) => <span className="font-mono text-xs">{row.original.dispatchNo}</span> },
  { id: "dispatchedAt", header: "Tarih", meta: { label: "Tarih", exportValue: (j) => formatFactory(j.dispatchedAt, "dd.MM.yyyy HH:mm") }, accessorFn: (j) => j.dispatchedAt, cell: ({ row }) => formatFactory(row.original.dispatchedAt, "dd.MM.yyyy HH:mm") },
  { id: "firm", header: "Firma", meta: { label: "Firma" }, accessorFn: (j) => j.firm.name },
  { id: "goods", header: "Kumaş / Renk", size: 260, meta: { label: "Kumaş / Renk" }, accessorFn: goodsText },
  { id: "rolls", header: "Top", meta: { label: "Top", align: "right" }, accessorFn: (j) => j.rolls.length },
  { id: "qty", header: "Metre", meta: { label: "Metre", align: "right", exportValue: (j) => fmtM(j.totalQty) }, accessorFn: (j) => j.totalQty, cell: ({ row }) => fmtM(row.original.totalQty) },
];

function jobColumns(onOpen?: (j: KartelaJob) => void): ColumnDef<KartelaJob>[] {
  return [
    ...JOB_COLUMNS,
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: j } }) => (
        <PermissionGate permission="kartela:write">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); onOpen?.(j); }}>
            <PackageCheck className="h-3.5 w-3.5" /> Kabul Et
          </Button>
        </PermissionGate>
      ),
    },
  ];
}

export function OutstandingTab() {
  const [search, setSearch] = useState("");
  const [job, setJob] = useState<KartelaJob | null>(null);
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("kartela:write");
  const q = useQuery({
    queryKey: ["kartela", "outstanding"],
    queryFn: () => kartelaService.outstanding(),
    staleTime: 0, // tablet kabulü/iptali anında görünsün
  });
  const jobs = useMemo(() => groupOutstanding(q.data?.data ?? []), [q.data]);
  const shown = useMemo(() => filterJobs(jobs, search), [jobs, search]);
  const onOpen = canWrite ? setJob : undefined;
  const columns = useMemo(() => jobColumns(onOpen), [onOpen]);
  const table = useLocalTable({ tableKey: "kartela:outstanding", data: shown, columns, getRowId: (j) => j.dispatchId });

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <div className="relative w-80">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" aria-label={`Bekleyen kabullerde ara: ${SEARCH_HINT}`} title={SEARCH_HINT} placeholder="Ara…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bekleyen kabul" />
        </div>
      </ListToolbar>
      {!q.isLoading && shown.length > 0 ? (
        <DataTable table={table} onRowClick={onOpen} exportName="Bekleyen kabul" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : (
          <ListMessage className="text-sm text-muted-foreground">
            {jobs.length === 0 ? "Kartela firmalarında kabul bekleyen top yok." : "Aramaya uyan sevk yok."}
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={shown.length} label={`${shown.length} sevk · ${shown.reduce((s, j) => s + j.rolls.length, 0)} top bekliyor`} />
      <KartelaReceiveDialog job={job} onClose={() => setJob(null)} />
    </>
  );
}
