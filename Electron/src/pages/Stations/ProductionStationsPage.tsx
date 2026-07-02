import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, HardDrive, Palette, QrCode, Trash2, Power, PowerOff, EyeOff, Eye } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import { loadAllForPicker } from "@/lib/picker-loader";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { stationKindLabels } from "@/types/enums";

import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import type { StationFormValues } from "@/pages/Stations/schema";
import { StationFormDialog } from "@/pages/Stations/StationFormDialog";

import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { MachineQrPrintDialog } from "@/pages/Machines/MachineQrPrintDialog";
import type { MachineFormValues } from "@/pages/Machines/schema";
import { MachineFormDialog } from "@/pages/Machines/MachineFormDialog";

import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import { CapabilitiesEditSheet } from "@/pages/StationCapabilities/CapabilitiesEditSheet";

// Üretim akışındaki istasyon türleri — sevkiyat/diğer (OTHER) bu ekranda yok.
const PRODUCTION_KINDS = ["RAW_QC", "PROCESS_QC", "TAMBUR", "SUBCONTRACTOR"];

const buildStationPayload = (v: StationFormValues, initial: Station | null): Partial<Station> => ({
  code: initial?.code ?? generateCode(CODE_PREFIXES.STATION),
  name: v.name,
  type: v.type,
  kind: v.kind,
  department: v.department || null,
  isActive: v.isActive,
  defaultCategoryId: v.type === "EXTERNAL" ? v.defaultCategoryId ?? null : null,
});

const buildMachinePayload = (v: MachineFormValues, initial: Machine | null): Partial<Machine> => ({
  stationId: v.stationId,
  code: initial?.code ?? generateCode(CODE_PREFIXES.MACHINE),
  name: v.name,
  // Aktif/pasif form dışında yönetilir (Pasife Al / Aktifleştir aksiyonları).
});

export function ProductionStationsPage() {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("station:write");

  const [showInactive, setShowInactive] = useState(false);

  const stationsQ = useQuery({ queryKey: ["stations", "card"], queryFn: () => loadAllForPicker(stationService) });
  // showInactive → filtresiz yükle (pasif makineler de gelsin); aksi halde yalnız aktif.
  const machinesQ = useQuery({
    queryKey: ["machines", "card", showInactive],
    queryFn: () => loadAllForPicker(machineService, showInactive ? { filters: {} } : undefined),
  });
  const capsQ = useQuery({ queryKey: ["station-capabilities"], queryFn: () => stationCapabilityService.list() });

  const stationMut = useCrudMutations({ service: stationService, queryKey: "stations", entityName: "İstasyon" });
  const machineMut = useCrudMutations({ service: machineService, queryKey: "machines", entityName: "Makine" });

  const [stationDlg, setStationDlg] = useState<{ open: boolean; initial: Station | null }>({ open: false, initial: null });
  const [machineDlg, setMachineDlg] = useState<{ open: boolean; initial: Machine | null; stationId?: string }>({ open: false, initial: null });
  const [capStation, setCapStation] = useState<StationCapabilitySummary | null>(null);
  const [qrMachine, setQrMachine] = useState<Machine | null>(null);
  const [deleteMachine, setDeleteMachine] = useState<Machine | null>(null);
  const [deactivateMachine, setDeactivateMachine] = useState<Machine | null>(null);

  const stations = (stationsQ.data?.data ?? []).filter((s) => PRODUCTION_KINDS.includes(s.kind));
  const machines = machinesQ.data?.data ?? [];
  const capByStation = new Map((capsQ.data?.data ?? []).map((c) => [c.stationId, c]));

  const handleStationSubmit = (values: StationFormValues) => {
    const payload = buildStationPayload(values, stationDlg.initial);
    const p = stationDlg.initial
      ? stationMut.updateMutation.mutateAsync({ id: stationDlg.initial.id, data: payload })
      : stationMut.createMutation.mutateAsync(payload);
    void p.then(() => setStationDlg({ open: false, initial: null }));
  };

  const handleMachineSubmit = (values: MachineFormValues) => {
    const payload = buildMachinePayload(values, machineDlg.initial);
    const p = machineDlg.initial
      ? machineMut.updateMutation.mutateAsync({ id: machineDlg.initial.id, data: payload })
      : machineMut.createMutation.mutateAsync(payload);
    void p.then(() => setMachineDlg({ open: false, initial: null }));
  };

  const handleMachineDelete = () => {
    if (!deleteMachine) return;
    void machineMut.hardRemoveMutation
      .mutateAsync(deleteMachine.id)
      .then(() => setDeleteMachine(null))
      .catch(() => {
        /* 409 (kullanımda) → apiClient interceptor backend mesajını toast'lar; modal açık kalır */
      });
  };

  const handleMachineDeactivate = () => {
    if (!deactivateMachine) return;
    void machineMut.removeMutation.mutateAsync(deactivateMachine.id).then(() => setDeactivateMachine(null));
  };

  const loading = stationsQ.isLoading || machinesQ.isLoading;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Üretim İstasyonları"
        description="Üretim akışındaki istasyonlar, makineleri ve (fason) renk/özellik yetenekleri. Tablet/yazıcı/kantar burada değil — Cihazlar/Donanım'da."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey="stations" />
            <Button
              size="sm"
              variant={showInactive ? "default" : "outline"}
              className={showInactive ? "bg-amber-500 text-white hover:bg-amber-600" : "border-amber-400 text-amber-600 hover:bg-amber-50"}
              onClick={() => setShowInactive((v) => !v)}
            >
              {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {showInactive ? "Pasifleri gizle" : "Pasifleri göster"}
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setStationDlg({ open: true, initial: null })}>
                <Plus className="h-4 w-4" /> İstasyon
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 space-y-3 overflow-auto p-6">
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && stations.length === 0 && (
          <div className="text-sm text-muted-foreground">Üretim istasyonu yok.</div>
        )}
        {stations.map((s) => {
          const sMachines = machines.filter((m) => m.stationId === s.id);
          const cap = capByStation.get(s.id);
          const capEditable = !!(cap && (cap.canApplyColor || cap.canApplyProperty));
          return (
            <Card key={s.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="secondary">{stationKindLabels[s.kind]}</Badge>
                    {!s.isActive && <Badge variant="outline">pasif</Badge>}
                  </div>
                  {canWrite && (
                    <Button variant="ghost" size="sm" onClick={() => setStationDlg({ open: true, initial: s })}>
                      <Pencil className="h-3.5 w-3.5" /> Düzenle
                    </Button>
                  )}
                </div>

                {/* Makineler */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Makineler:</span>
                  {sMachines.length === 0 && <span className="text-muted-foreground">—</span>}
                  {sMachines.map((m) => {
                    const active = m.isActive !== false;
                    return (
                      <span
                        key={m.id}
                        className={`inline-flex items-center overflow-hidden rounded border ${active ? "" : "border-dashed opacity-60"}`}
                      >
                        <button
                          type="button"
                          disabled={!canWrite}
                          className="px-2 py-0.5 text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                          onClick={() => canWrite && setMachineDlg({ open: true, initial: m })}
                          title={canWrite ? "Düzenle" : undefined}
                        >
                          {m.name}
                          {!active && <span className="ml-1 text-[10px] text-muted-foreground">(pasif)</span>}
                        </button>
                        {/* Oturum QR'ı — yalnız aktif makinede (pasif makineye oturum açılmaz) */}
                        {active && (
                          <button
                            type="button"
                            className="border-l px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() => setQrMachine(m)}
                            title="Makine QR etiketi (oturum açma)"
                          >
                            <QrCode className="h-3 w-3" />
                          </button>
                        )}
                        {canWrite && active && (
                          <button
                            type="button"
                            className="border-l px-1.5 py-0.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                            onClick={() => setDeactivateMachine(m)}
                            title="Pasife al (geri alınabilir)"
                          >
                            <PowerOff className="h-3 w-3" />
                          </button>
                        )}
                        {canWrite && !active && (
                          <button
                            type="button"
                            className="border-l px-1.5 py-0.5 text-emerald-600 hover:bg-emerald-500/10"
                            onClick={() => machineMut.restoreMutation.mutate(m.id)}
                            title="Aktifleştir"
                          >
                            <Power className="h-3 w-3" />
                          </button>
                        )}
                        {canWrite && (
                          <button
                            type="button"
                            className="border-l px-1.5 py-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteMachine(m)}
                            title="Kalıcı sil"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
                  {canWrite && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setMachineDlg({ open: true, initial: null, stationId: s.id })}
                    >
                      <Plus className="h-3 w-3" /> Makine
                    </Button>
                  )}
                </div>

                {/* Yetenekler (fason istasyonları) */}
                {capEditable && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Yetenekler:</span>
                    <span className="text-xs">🎨 {cap!.colorCount} renk · ⚙ {cap!.propertyCount} özellik</span>
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setCapStation(cap!)}
                      >
                        Düzenle
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <StationFormDialog
        open={stationDlg.open}
        onOpenChange={(o) => !o && setStationDlg({ open: false, initial: null })}
        initial={stationDlg.initial}
        onSubmit={handleStationSubmit}
        isSubmitting={stationMut.createMutation.isPending || stationMut.updateMutation.isPending}
      />
      <MachineFormDialog
        open={machineDlg.open}
        onOpenChange={(o) => !o && setMachineDlg({ open: false, initial: null })}
        initial={machineDlg.initial}
        defaultStationId={machineDlg.stationId}
        onSubmit={handleMachineSubmit}
        isSubmitting={machineMut.createMutation.isPending || machineMut.updateMutation.isPending}
      />
      <CapabilitiesEditSheet
        station={capStation}
        open={!!capStation}
        onOpenChange={(o) => !o && setCapStation(null)}
      />
      <MachineQrPrintDialog machine={qrMachine} onOpenChange={(o) => !o && setQrMachine(null)} />

      <ConfirmDialog
        open={!!deleteMachine}
        onOpenChange={(o) => !o && setDeleteMachine(null)}
        title="Makineyi kalıcı sil"
        description={
          deleteMachine
            ? `"${deleteMachine.name}" makinesi kalıcı olarak silinecek. Bu işlem geri alınamaz. ` +
              `Makine üretimde kullanılmışsa (oturum/işlem/hareket/top girişi) veya bir cihaz/donanım bağlıysa ` +
              `silme reddedilir — bu durumda makineyi düzenleyip pasife alın.`
            : undefined
        }
        confirmLabel="Kalıcı sil"
        destructive
        onConfirm={handleMachineDelete}
        isPending={machineMut.hardRemoveMutation.isPending}
      />

      <ConfirmDialog
        open={!!deactivateMachine}
        onOpenChange={(o) => !o && setDeactivateMachine(null)}
        title="Makineyi pasife al"
        description={
          deactivateMachine
            ? `"${deactivateMachine.name}" makinesi pasife alınacak — üretim geçmişi korunur ve istediğiniz zaman "Aktifleştir" ile geri getirebilirsiniz. ` +
              `Pasif makine "Pasifleri göster" ile listelenir.`
            : undefined
        }
        confirmLabel="Pasife al"
        onConfirm={handleMachineDeactivate}
        isPending={machineMut.removeMutation.isPending}
      />
    </div>
  );
}
