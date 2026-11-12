// =============================================================================
// MALİYET › MAKİNE SAAT ÜCRETLERİ (D4-G1b) — `cost:read` görür, `cost:write` girer/değiştirir/kaldırır.
// Makine listesi `station:read` varsa makine ucundan, yoksa `cost:read` kapsamlı hafif seçenek ucundan
// (`/api/cost/machine-options`, yalnız id/kod/ad) gelir — Muhasebe de ücretsiz makineye satırından ücret girer.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { machineService } from "@/pages/Machines/service";
import { CostQueryError } from "../shared/CostQueryState";
import { machineRateColumns } from "./columns";
import { MachineRateDialog } from "./MachineRateDialog";
import { MachineRateHistorySheet } from "./MachineRateHistorySheet";
import { machineRateService, type MachineCostRate } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

type MachineBrief = { id: string; code: string; name: string };
export interface MachineRateRow { machine: MachineBrief; rate: MachineCostRate | null }

/** Ücretli satırlar + (makine listesi okunduysa) ücretsiz makineler; koda göre sıralı. */
export function mergeMachineRows(rates: MachineCostRate[], machines: MachineBrief[] | null): MachineRateRow[] {
  const byMachine = new Map(rates.map((r) => [r.machineId, r]));
  const rows: MachineRateRow[] = rates.map((r) => ({ machine: r.machine, rate: r }));
  for (const m of machines ?? []) if (!byMachine.has(m.id)) rows.push({ machine: m, rate: null });
  return rows.sort((a, b) => a.machine.code.localeCompare(b.machine.code, "tr"));
}

type Edit = { current: MachineCostRate | null; machine: MachineBrief | null };

export function MachineRatesPage() {
  const { hasPermission } = useRoleAccess();
  const canListMachines = hasPermission("station:read");
  const q = useQuery({ queryKey: ["cost-machine-rates", "active"], queryFn: machineRateService.listActive });
  const machinesQ = useQuery({
    queryKey: ["machines", "cost-rate-list", canListMachines ? "station" : "cost"],
    queryFn: async (): Promise<MachineBrief[]> =>
      canListMachines ? (await loadAllForPicker(machineService, { sortBy: "code" })).data : machineRateService.machineOptions(),
  });
  const [edit, setEdit] = useState<Edit | null>(null);
  const [history, setHistory] = useState<MachineCostRate | null>(null);
  const rows = mergeMachineRows(q.data ?? [], machinesQ.data ?? null);
  const table = useLocalTable({ tableKey: "cost:machine-rates", data: rows, columns: useMemo(() => machineRateColumns(setEdit, setHistory), []), getRowId: (r) => r.machine.id });
  return (
    <PageShell>
      <PageHeader
        title="Makine Saat Ücretleri"
        description="Kârlılıkta makineye giden maliyet: saat ücreti (TL) ve beklenen metre/saat. Değişiklik şu andan itibaren geçerli yeni sürümdür; eski ücret damgalı kalır."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-machine-rates"]} extraKeys={[["machines", "cost-rate-list"]]} />
            {canListMachines ? (
              <PermissionGate permission="cost:write">
                <Button onClick={() => setEdit({ current: null, machine: null })}><Plus className="mr-1 h-4 w-4" />Ücret gir</Button>
              </PermissionGate>
            ) : null}
          </div>
        }
      />
      <ListToolbar className="flex-row items-center justify-end">
        <DataTableTools table={table} compact exportName="Makine saat ücretleri" />
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Makine saat ücretleri" />
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Makine saat ücretleri" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz makine saat ücreti yok — ücreti olmayan makinenin çalışması kârlılıkta "ücret eksik" sayılır.
            </div>
          </ListMessage>
        )}
      </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <MachineRateDialog onClose={() => setEdit(null)} current={edit.current} machine={edit.machine} />}
      {history && <MachineRateHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
