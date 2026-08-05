import { useEffect, useMemo, useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { PoolPanel } from "./PoolPanel";
import { MachinePanel } from "./MachinePanel";
import { KursunDagitimCompleteDialog } from "./KursunDagitimCompleteDialog";
import { applyGroupOrder, reorderRows } from "./queue-reorder";
import { buildTabs, POOL_TAB } from "./machine-tabs";
import { DISTRIBUTION_QUERY_KEY, useKursunDistribution } from "./useKursunDistribution";
import type {
  KursunDistributionAssignedRow,
  KursunDistributionWaitingRow,
} from "./types";

/**
 * Kurşun Planlama — kurşun adımının TEK planlama yüzeyi.
 *
 * TASARIM (2026-08-05): **havuz + makine başına birer SEKME**. Eski hâlinde
 * bekleyenler ve tüm makineler alt alta duruyordu; makine sayısı arttıkça sayfa
 * uzuyor ve toplu seçim iki makineye birden taşabiliyordu. Sekme bunu yapısal
 * olarak çözer — ekranda tek liste vardır, "seçtiklerim nereye ait" sorusu
 * doğmaz.
 *
 * "Hangi makine ne kadar dolu?" görünürlüğü SEKME ŞERİDİNE taşındı (her sekmede
 * iş adedi + metraj + bayat rozeti): sekmeye geçmeden yükü görebilmek, dağıtım
 * kararının ön koşuludur.
 *
 * ⚠️ EKRAN BAYRAKTAN BAĞIMSIZ: menüde her zaman durur, yalnız izinle süzülür.
 * Bayrak SADECE dağıtım kontrollerini açıp kapatır; sıralama ve acil işaretleme
 * her iki rejimde de çalışır.
 */
export function KursunDagitimPage() {
  const { hasAnyPermission } = useRoleAccess();
  const canReorder = hasAnyPermission(["quality:write", "workorder:distribute"]);

  const d = useKursunDistribution();
  const data = d.query.data?.data;
  const flagEnabled = data?.flagEnabled ?? false;
  const machines = useMemo(() => data?.machines ?? [], [data]);

  // Sürükleme İYİMSER güncellenir → iki liste de yerel state'te tutulur ve her
  // sunucu yanıtında tazelenir. Doğrudan `query.data`'dan okumak, sürükleme ile
  // sunucu yanıtı arasındaki ~200ms'de satırı eski yerine geri zıplatırdı.
  const [waiting, setWaiting] = useState<KursunDistributionWaitingRow[]>([]);
  const [assigned, setAssigned] = useState<KursunDistributionAssignedRow[]>([]);
  useEffect(() => {
    setWaiting(data?.waiting ?? []);
    setAssigned(data?.assigned ?? []);
  }, [data]);

  const [tab, setTab] = useState<string>(POOL_TAB);
  /**
   * Seçim TEK dizidir ama sekme değişince TEMİZLENİR. Sekmeler arası taşınan bir
   * seçim, görünmeyen satırlar üzerinde toplu işlem yaptırırdı — panellerin
   * `visibleSelection` kesişimi ikinci hattır, bu birincisi.
   */
  const [selected, setSelected] = useState<string[]>([]);
  const changeTab = (next: string) => {
    setTab(next);
    setSelected([]);
  };

  const [completeRow, setCompleteRow] = useState<KursunDistributionAssignedRow | null>(
    null,
  );

  const tabs = useMemo(
    () => buildTabs(machines, waiting, assigned),
    [machines, waiting, assigned],
  );
  // Sekme kayboldu mu (makine pasifleşti / son iş bitti) → havuza düş.
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === tab)) changeTab(POOL_TAB);
  }, [tabs, tab]);

  /** Seçili adım id'lerinden iş emri id'leri (toplu dağıtım/taşıma payload'ı). */
  const workOrderIdsOf = (stepIds: string[]) =>
    [...waiting, ...assigned]
      .filter((r) => stepIds.includes(r.workOrderStepId))
      .map((r) => r.workOrderId);

  /** Seçili adım id'lerinden atama id'leri (toplu havuza alma payload'ı). */
  const assignmentIdsOf = (stepIds: string[]) =>
    assigned
      .filter((r) => stepIds.includes(r.workOrderStepId))
      .map((r) => r.assignmentId);

  const runBulkAssign = (stepIds: string[], machineId: string) => {
    const workOrderIds = workOrderIdsOf(stepIds);
    if (workOrderIds.length === 0 || !machineId) return;
    d.assignBulk.mutate({ workOrderIds, machineId });
    setSelected([]);
  };

  const runBulkCancel = (stepIds: string[]) => {
    const assignmentIds = assignmentIdsOf(stepIds);
    if (assignmentIds.length === 0) return;
    d.cancelBulk.mutate({ assignmentIds });
    setSelected([]);
  };

  /** Havuz sürüklemesi — priority hesabı `reorderRows`'de (saf, birim testli). */
  const handlePoolDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const result = reorderRows(waiting, String(active.id), String(over.id));
    if (!result) return;
    setWaiting(result.next);
    if (result.payload.length > 0) d.reorder.mutate(result.payload);
  };

  /** Makine içi sıralama — yeni sıra `applyGroupOrder` ile düz diziye örülür. */
  const handleMachineReorder = (machineId: string, activeId: string, overId: string) => {
    const groupRows = assigned.filter((r) => r.machineId === machineId);
    const result = reorderRows(groupRows, activeId, overId);
    if (!result) return;
    setAssigned(applyGroupOrder(assigned, machineId, result.next));
    if (result.payload.length > 0) d.reorder.mutate(result.payload);
  };

  return (
    <PageShell>
      <PageHeader
        title="Kurşun Planlama"
        description="Havuzdaki işleri sırala ve kurşun makinelerine dağıt; makineler arasında taşı."
        actions={
          <RefreshButton
            queryKey={DISTRIBUTION_QUERY_KEY}
            successMessage="Liste yenilendi"
          />
        }
      />

      <PageBody className="p-4">
        {d.query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <Tabs value={tab} onValueChange={changeTab} className="space-y-3">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              {tabs.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-2">
                  <span>{t.label}</span>
                  <Badge variant="muted" className="tabular-nums">
                    {t.count}
                  </Badge>
                  <span className="text-muted-foreground text-[11px] tabular-nums">
                    {formatNumber(t.meters, 0)} m
                  </span>
                  {t.staleCount > 0 && (
                    <Badge variant="outline" className="text-warning-foreground text-[10px]">
                      {t.staleCount} bayat
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={POOL_TAB} className="mt-0">
              <PoolPanel
                rows={waiting}
                machines={machines}
                busy={d.busy}
                flagEnabled={flagEnabled}
                canReorder={canReorder}
                selected={selected}
                onSelectedChange={setSelected}
                onDragEnd={handlePoolDragEnd}
                onAssignOne={(row, machineId) =>
                  d.assign.mutate({ workOrderId: row.workOrderId, machineId })
                }
                onToggleUrgent={(row) =>
                  d.setUrgent.mutate({
                    stepId: row.workOrderStepId,
                    isUrgent: !row.isUrgent,
                  })
                }
                onAssignBulk={runBulkAssign}
              />
            </TabsContent>

            {tabs
              .filter((t) => t.key !== POOL_TAB)
              .map((t) => (
                <TabsContent key={t.key} value={t.key} className="mt-0">
                  <MachinePanel
                    machineId={t.key}
                    machineName={t.label}
                    rows={assigned.filter((r) => r.machineId === t.key)}
                    machines={machines}
                    busy={d.busy}
                    canReorder={canReorder}
                    selected={selected}
                    onSelectedChange={setSelected}
                    onReorder={handleMachineReorder}
                    onToggleUrgent={(row) =>
                      d.setUrgent.mutate({
                        stepId: row.workOrderStepId,
                        isUrgent: !row.isUrgent,
                      })
                    }
                    onComplete={setCompleteRow}
                    onCancelOne={(row) => d.cancel.mutate(row.assignmentId)}
                    onCancelBulk={runBulkCancel}
                    onMoveBulk={runBulkAssign}
                  />
                </TabsContent>
              ))}
          </Tabs>
        )}
      </PageBody>

      <KursunDagitimCompleteDialog
        open={completeRow !== null}
        onOpenChange={(open) => {
          if (!open) setCompleteRow(null);
        }}
        row={completeRow}
        onCompleted={d.refresh}
      />
    </PageShell>
  );
}
