// =============================================================================
// TEZGAH / MAKİNE DURUŞLARI — Faz 1b web yüzeyi (vardiya amiri); D4-A3 dokumasız rejim
// =============================================================================
// Sınıflandırma kuyruğu (`requiresReason ∧ reasonCode null`), sebep atama /
// yeniden sınıflandırma (web-only; reclass DEFTERİ görünür), elle duruş girişi /
// kapatma / geri alma; watchdog'un geçici kapattığı duruşlar ayrı kapsam. Süzme SUNUCUDA: gün · makine · istasyon türü ·
// vardiya · kuyruk. ⚠️ REJİM: karo `isMachineStopsVisible` (`stop-regime.ts`); asıl sed backend
// `requireMachineStopRegime`. Başlık dokuma açıkken bugünkü, dokumasız rejimde "Makine Duruşları". Ekranı `loom:manual-entry` | `loom:classify` açar,
// eylemler ekran içinde izinle (`StopRowMenu`).
// ⚠️ "HATA" ile "KAYIT YOK" ayrı ekranlardır (`DataTable.isError`).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { FilterBar } from "@/components/data-table/FilterBar";
import { machineStopService } from "./service";
import { StopsTable } from "./StopsTable";
import { StopEntryDialog } from "./StopEntryDialog";
import { StopReasonDialog } from "./StopReasonDialog";
import { StopCloseDialog, StopRevokeDialog } from "./StopSimpleDialogs";
import { StopReclassLedgerDialog } from "./StopReclassLedgerDialog";
import { MACHINE_STOPS_QUERY_KEY, useMachineStopMutations } from "./useMachineStopMutations";
import { useStopReasonPresets } from "./useStopReasonPresets";
import { useMinuteTick, useStopActions, useStopFilters, useStopListParams, type DialogState } from "./useStopsPageState";
import { todayKey } from "./types";
import { machineNoun, machineStopsTitle } from "./stop-regime";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { DatePickerInput } from "@/components/forms/DatePickerInput";

export function MachineStopsPage() {
  const [day, setDay] = useState(todayKey());
  const [dialog, setDialog] = useState<DialogState>(null);
  const nowMs = useMinuteTick();
  const { params, dayFree } = useStopListParams(day);
  const query = useQuery({ queryKey: [MACHINE_STOPS_QUERY_KEY, params], queryFn: () => machineStopService.list(params) });
  const rows = useMemo(() => query.data?.data ?? [], [query.data]);
  const { dokumaEnabled } = useOperationsVisibilityContext();
  const filters = useStopFilters(rows, dokumaEnabled);
  const noun = machineNoun({ dokumaEnabled });
  const actions = useStopActions(setDialog);
  const { active, labelOf } = useStopReasonPresets();
  const { open, close, classify, reclassify, revoke, stampError, clearStampError } = useMachineStopMutations(() => setDialog(null));
  const closeDialog = () => {
    clearStampError();
    setDialog(null);
  };

  return (
    <PageShell>
      <PageHeader
        title={machineStopsTitle({ dokumaEnabled })}
        description="Sebep bekleyen duruşlar (kuyruk), sebep atama ve yeniden sınıflandırma, elle duruş girişi. Kayıp sınıfı sebepten gelir; değişim deftere yazılır."
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="loom:manual-entry">
              <Button size="sm" onClick={() => setDialog({ kind: "entry" })}>
                <Plus className="mr-1 h-4 w-4" />
                Elle Duruş Gir
              </Button>
            </PermissionGate>
            <RefreshButton queryKey={MACHINE_STOPS_QUERY_KEY} />
          </div>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="stops-day">Fabrika günü</Label>
          <DatePickerInput id="stops-day" value={day} onChange={setDay} disabled={dayFree} className="w-44" />
        </div>
        <FilterBar filters={filters} />
      </div>
      <StopsTable rows={rows} isLoading={query.isLoading} isError={query.isError} onRetry={() => void query.refetch()} labelOf={labelOf} nowMs={nowMs} actions={actions} noun={noun} />
      {/* Diyaloglar KOŞULLU mount: her açılış taze bileşen ve taze `clientToken`. */}
      {dialog?.kind === "entry" && <StopEntryDialog presets={active} isPending={open.isPending} onClose={closeDialog} onConfirm={(b) => open.mutateAsync(b)} stampError={stampError} noun={noun} />}
      {(dialog?.kind === "classify" || dialog?.kind === "reclassify") && (
        <StopReasonDialog
          target={dialog.target}
          mode={dialog.kind}
          presets={active}
          labelOf={labelOf}
          isPending={classify.isPending || reclassify.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(code, note) =>
            dialog.kind === "classify"
              ? classify.mutate({ id: dialog.target.id, reasonCode: code, reasonNote: note })
              : reclassify.mutate({ id: dialog.target.id, fromReasonCode: dialog.target.reasonCode ?? "", toReasonCode: code, reason: note })
          }
        />
      )}
      {dialog?.kind === "close" && <StopCloseDialog target={dialog.target} isPending={close.isPending} onClose={closeDialog} onConfirm={(endedAt) => close.mutate({ id: dialog.target.id, endedAt })} stampError={stampError} />}
      {dialog?.kind === "revoke" && <StopRevokeDialog target={dialog.target} isPending={revoke.isPending} onClose={() => setDialog(null)} onConfirm={(reason) => revoke.mutate({ id: dialog.target.id, reason })} />}
      {dialog?.kind === "ledger" && <StopReclassLedgerDialog target={dialog.target} labelOf={labelOf} onClose={() => setDialog(null)} />}
    </PageShell>
  );
}
