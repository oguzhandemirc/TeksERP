import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { formatNumber } from "@/lib/format";
import { kursunDagitimService } from "./service";
import { EligibleRow } from "./EligibleRow";
import { AssignedMachineGroup, groupAssignedByMachine } from "./AssignedMachineGroup";
import { KursunDagitimCompleteDialog } from "./KursunDagitimCompleteDialog";
import type { KursunDistributionAssignedRow } from "./types";

const QUERY_KEY = ["kursun-bypass", "distribution"];

/**
 * Kurşun Dağıtım — kurşun makinelerinde tablet YOK; işi planlamacı buradan
 * fiziksel kurşun MAKİNELERİNE dağıtır (istasyon tek, makineler N tane). İki
 * bölüm ÜST ÜSTE durur (sekme DEĞİL): planlamacı "ne bekliyor" ile "hangi
 * makine ne kadar dolu" sorularını aynı anda görmeden karar veremez.
 */
export function KursunDagitimPage() {
  const qc = useQueryClient();
  const [completeRow, setCompleteRow] = useState<KursunDistributionAssignedRow | null>(
    null,
  );

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => kursunDagitimService.getDistribution(),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const data = query.data?.data;
  const flagEnabled = data?.flagEnabled ?? false;
  const machines = data?.machines ?? [];
  const waiting = data?.waiting ?? [];
  // `?? []` her render'da YENİ dizi doğurur → useMemo bağımlılığı olarak
  // kullanılamaz (gruplama her render'da yeniden koşar). Referansı sabitle.
  const assigned = useMemo(() => data?.assigned ?? [], [data]);
  const groups = useMemo(() => groupAssignedByMachine(assigned), [assigned]);

  const eligibleCount = waiting.filter((w) => w.eligible).length;
  const staleCount = assigned.filter((a) => a.stale).length;
  const assignedMeters = assigned.reduce((s, a) => s + a.totalMeters, 0);

  /** Dağıtım kurşun kuyruğunun bypass rozetini de değiştirir → ikisi birlikte tazelenir. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
    void qc.invalidateQueries({ queryKey: ["kursun-queue"] });
  };

  const assignMut = useMutation({
    mutationFn: kursunDagitimService.assign,
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri makineye dağıtıldı.");
      refresh();
    },
  });

  const cancelMut = useMutation({
    mutationFn: (assignmentId: string) => kursunDagitimService.cancel(assignmentId),
    onSuccess: (res) => {
      toast.success(res.message ?? "Dağıtım kaldırıldı.");
      refresh();
    },
  });

  const urgentMut = useMutation({
    mutationFn: (v: { stepId: string; isUrgent: boolean }) =>
      kursunDagitimService.setUrgent(v.stepId, v.isUrgent),
    onSuccess: () => {
      toast.success("Acillik durumu güncellendi.");
      refresh();
    },
  });

  const busy = assignMut.isPending || cancelMut.isPending || urgentMut.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Kurşun Dağıtım"
        description="Kurşun adımında bekleyen iş emirlerini fiziksel kurşun makinelerine dağıt."
        actions={
          <RefreshButton queryKey={QUERY_KEY} successMessage="Dağıtım listesi yenilendi" />
        }
      />

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-xs">
        <span>
          <span className="text-foreground font-medium">{waiting.length}</span> bekleyen
          {waiting.length > 0 && ` (${eligibleCount} uygun)`}
        </span>
        <span>
          <span className="text-foreground font-medium">{assigned.length}</span> dağıtılmış
          · {groups.length} makine · {formatNumber(assignedMeters, 0)} m
        </span>
        {staleCount > 0 && (
          <span className="text-warning-foreground">{staleCount} bayat dağıtım</span>
        )}
      </div>

      <PageBody className="space-y-6 p-4">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            {!flagEnabled && (
              <div className="bg-muted/30 flex items-start gap-2 rounded-md border p-3 text-xs">
                <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Kurşun bypass özelliği kapalı — yeni dağıtım yapılamaz; mevcut atamalar
                  çalışmaya devam eder.
                </span>
              </div>
            )}

            {flagEnabled && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Dağıtım Bekleyen</h2>
                {waiting.length === 0 ? (
                  <div className="text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm">
                    Kurşun adımında dağıtım bekleyen iş emri yok.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {waiting.map((row) => (
                      <EligibleRow
                        key={row.workOrderStepId}
                        row={row}
                        machines={machines}
                        busy={busy}
                        flagEnabled={flagEnabled}
                        onAssign={(machineId) =>
                          assignMut.mutate({ workOrderId: row.workOrderId, machineId })
                        }
                        onToggleUrgent={() =>
                          urgentMut.mutate({
                            stepId: row.workOrderStepId,
                            isUrgent: !row.isUrgent,
                          })
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Makinelere Dağıtılmış</h2>
              {groups.length === 0 ? (
                <div className="text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm">
                  Hiçbir makineye dağıtılmış iş emri yok.
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map((group) => (
                    <AssignedMachineGroup
                      key={group.machineId}
                      group={group}
                      busy={busy}
                      onCancel={(row) => cancelMut.mutate(row.assignmentId)}
                      onToggleUrgent={(row) =>
                        urgentMut.mutate({
                          stepId: row.workOrderStepId,
                          isUrgent: !row.isUrgent,
                        })
                      }
                      onComplete={(row) => setCompleteRow(row)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </PageBody>

      <KursunDagitimCompleteDialog
        open={completeRow !== null}
        onOpenChange={(open) => {
          if (!open) setCompleteRow(null);
        }}
        row={completeRow}
        onCompleted={refresh}
      />
    </PageShell>
  );
}
