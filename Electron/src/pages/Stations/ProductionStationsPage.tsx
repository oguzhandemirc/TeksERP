import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { loadAllForPicker } from "@/lib/picker-loader";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import type { StationKind } from "@/types/enums";

import { stationService } from "@/pages/Stations/service";
import type { Station } from "@/pages/Stations/types";
import type { StationFormValues } from "@/pages/Stations/schema";
import { StationFormDialog } from "@/pages/Stations/StationFormDialog";

import { machineService, getMachineDeletePreview } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { MachineQrPrintDialog } from "@/pages/Machines/MachineQrPrintDialog";
import type { MachineFormValues } from "@/pages/Machines/schema";
import { MachineFormDialog } from "@/pages/Machines/MachineFormDialog";
import { StationCard } from "@/pages/Stations/StationCard";
import { StationFilterBar, type MachinePresence } from "@/pages/Stations/StationFilterBar";

import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import { CapabilitiesEditSheet } from "@/pages/StationCapabilities/CapabilitiesEditSheet";

// Üretim akışındaki istasyon türleri — sevkiyat/diğer (OTHER) bu ekranda yok.
const PRODUCTION_KINDS: StationKind[] = ["RAW_QC", "PROCESS_QC", "TAMBUR", "SUBCONTRACTOR"] as StationKind[];

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
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stationId, setStationId] = useState("__all__");
  const [machinePresence, setMachinePresence] = useState<MachinePresence>("all");
  const [capOnly, setCapOnly] = useState(false);

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

  const allStations = useMemo(
    () => (stationsQ.data?.data ?? []).filter((s) => PRODUCTION_KINDS.includes(s.kind)),
    [stationsQ.data],
  );
  const capByStation = useMemo(
    () => new Map((capsQ.data?.data ?? []).map((c) => [c.stationId, c])),
    [capsQ.data],
  );
  const machinesByStation = useMemo(() => {
    const map = new Map<string, Machine[]>();
    for (const m of machinesQ.data?.data ?? []) {
      const list = map.get(m.stationId);
      if (list) list.push(m);
      else map.set(m.stationId, [m]);
    }
    return map;
  }, [machinesQ.data]);
  const hasAnyFason = useMemo(() => allStations.some((s) => s.kind === "SUBCONTRACTOR"), [allStations]);

  // İstemci-tarafı filtre — tüm veri zaten yüklü (loadAllForPicker). AND (boyutlar
  // arası) + OR (Tür chip'leri içinde). showInactive filtre DEĞİL, makine yüklemesini sürer.
  const stations = useMemo(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase("tr");
    return allStations.filter((s) => {
      if (stationId !== "__all__" && s.id !== stationId) return false;

      const sm = machinesByStation.get(s.id) ?? [];
      if (machinePresence === "has" && sm.length === 0) return false;
      if (machinePresence === "none" && sm.length > 0) return false;
      if (machinePresence === "active" && !sm.some((m) => m.isActive !== false)) return false;

      if (capOnly) {
        const cap = capByStation.get(s.id);
        if (!cap || !(cap.canApplyColor || cap.canApplyProperty)) return false;
      }

      if (q) {
        const hay = [s.name, s.code, s.department ?? "", ...sm.flatMap((m) => [m.name, m.code])]
          .join(" ")
          .toLocaleLowerCase("tr");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allStations, stationId, machinePresence, capOnly, debouncedSearch, machinesByStation, capByStation]);

  const anyFilterActive =
    debouncedSearch.trim() !== "" || stationId !== "__all__" || machinePresence !== "all" || capOnly;

  const clearFilters = () => {
    setSearch("");
    setStationId("__all__");
    setMachinePresence("all");
    setCapOnly(false);
  };

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

  // Silme önizlemesi — modal açıldığında (deleteMachine set) çekilir. Silinebilir mi
  // + kaç oturum temizlenecek. Üretim izi varsa deletable=false → onay pasif.
  const deletePreviewQ = useQuery({
    queryKey: ["machine-delete-preview", deleteMachine?.id],
    queryFn: () => getMachineDeletePreview(deleteMachine!.id),
    enabled: !!deleteMachine,
  });
  const preview = deletePreviewQ.data;

  const deleteDescription = (() => {
    if (!deleteMachine) return undefined;
    if (deletePreviewQ.isLoading) return "Kontrol ediliyor…";
    if (!preview) return "Önizleme alınamadı — makineyi pasife almayı deneyin.";
    if (!preview.deletable) {
      return (
        `"${deleteMachine.name}" kalıcı silinemez — ` +
        preview.blockers.map((b) => b.message).join("; ") +
        `. Bunun yerine makineyi pasife alın (üretim geçmişi korunur).`
      );
    }
    const sess =
      preview.workSessionCount > 0
        ? ` Bu makinede yalnız ${preview.workSessionCount} oturum (login) kaydı var, üretim izi yok — silmede o kayıt(lar) da temizlenecek (denetim izi SystemLog'da kalır).`
        : "";
    return `"${deleteMachine.name}" kalıcı olarak silinecek. Bu işlem geri alınamaz.${sess}`;
  })();

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
            {canWrite && (
              <Button size="sm" onClick={() => setStationDlg({ open: true, initial: null })}>
                <Plus className="h-4 w-4" /> İstasyon
              </Button>
            )}
          </div>
        }
      />

      <StationFilterBar
        search={search}
        onSearch={setSearch}
        stationId={stationId}
        onStationId={setStationId}
        machinePresence={machinePresence}
        onMachinePresence={setMachinePresence}
        capOnly={capOnly}
        onCapOnly={setCapOnly}
        hasAnyFason={hasAnyFason}
        stationOptions={allStations.map((s) => ({ id: s.id, name: s.name }))}
        visibleCount={stations.length}
        totalCount={allStations.length}
        anyFilterActive={anyFilterActive}
        onClear={clearFilters}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((v) => !v)}
      />

      <div className="flex-1 space-y-3 overflow-auto p-6">
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && allStations.length === 0 && (
          <div className="text-sm text-muted-foreground">Üretim istasyonu yok.</div>
        )}
        {!loading && allStations.length > 0 && stations.length === 0 && (
          <div className="text-sm text-muted-foreground">Filtreye uyan istasyon yok.</div>
        )}
        {stations.map((s) => (
          <StationCard
            key={s.id}
            station={s}
            machines={machinesByStation.get(s.id) ?? []}
            cap={capByStation.get(s.id)}
            canWrite={canWrite}
            onEditStation={(st) => setStationDlg({ open: true, initial: st })}
            onAddMachine={(stationId) => setMachineDlg({ open: true, initial: null, stationId })}
            onEditMachine={(m) => setMachineDlg({ open: true, initial: m })}
            onQrMachine={setQrMachine}
            onDeactivateMachine={setDeactivateMachine}
            onReactivateMachine={(m) => machineMut.restoreMutation.mutate(m.id)}
            onDeleteMachine={setDeleteMachine}
            onEditCap={setCapStation}
          />
        ))}
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
        description={deleteDescription}
        confirmLabel="Kalıcı sil"
        destructive
        onConfirm={handleMachineDelete}
        isPending={machineMut.hardRemoveMutation.isPending}
        confirmDisabled={deletePreviewQ.isLoading || !preview?.deletable}
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
