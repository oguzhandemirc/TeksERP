// =============================================================================
// MALİYET › MAKİNE SAAT ÜCRETLERİ (D4-G1b) — `cost:read` görür, `cost:write` girer/değiştirir/kaldırır.
// Makine listesi `station:read` varsa makine ucundan, yoksa `cost:read` kapsamlı hafif seçenek ucundan
// (`/api/cost/machine-options`, yalnız id/kod/ad) gelir — Muhasebe de ücretsiz makineye satırından ücret girer.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { fmtFactoryDate } from "@/lib/factory-time";
import { machineService } from "@/pages/Machines/service";
import { CostQueryError } from "../shared/CostQueryState";
import { fmtDecFull } from "../shared/format";
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
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Makine saat ücretleri" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz makine saat ücreti yok — ücreti olmayan makinenin çalışması kârlılıkta "ücret eksik" sayılır.
            </div>
          </ListMessage>
        ) : (
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Makine</th>
                <th className="px-3 py-2 text-right">Saat ücreti</th>
                <th className="px-3 py-2 text-right">Beklenen m/saat</th>
                <th className="px-3 py-2">Geçerli olduğu an</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RateRow key={r.machine.id} r={r}
                  onEdit={() => setEdit({ current: r.rate, machine: r.machine })}
                  onHistory={r.rate ? () => setHistory(r.rate) : undefined} />
              ))}
            </tbody>
          </table>
        )}
      </ListBody>
      <ListFooter loaded={rows.length} />
      {edit && <MachineRateDialog onClose={() => setEdit(null)} current={edit.current} machine={edit.machine} />}
      {history && <MachineRateHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}

function RateRow({ r, onEdit, onHistory }: { r: MachineRateRow; onEdit: () => void; onHistory?: () => void }) {
  const { rate } = r;
  return (
    <tr className="border-t">
      <td className="px-3 py-2"><span className="font-medium">{r.machine.code}</span> <span className="text-muted-foreground">{r.machine.name}</span></td>
      <td className="px-3 py-2 text-right tabular-nums">{rate ? `${fmtDecFull(rate.hourRateTry)} TL` : <span className="text-amber-600 dark:text-amber-400">ücret yok</span>}</td>
      <td className="px-3 py-2 text-right tabular-nums">{rate ? fmtDecFull(rate.normMPerHour, 2) : "—"}</td>
      <td className="px-3 py-2">{rate ? fmtFactoryDate(rate.createdAt) : "—"}</td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <PermissionGate permission="cost:write">
          <Button size="sm" variant="outline" onClick={onEdit}>{rate ? "Ücreti değiştir" : "Ücret gir"}</Button>
        </PermissionGate>
        {onHistory && <Button size="sm" variant="ghost" onClick={onHistory} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>}
      </td>
    </tr>
  );
}
