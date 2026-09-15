import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { loadAllForPicker } from "@/lib/picker-loader";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { stationKindLabels, stationTypeLabels } from "@/types/enums";

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
import { buildMachineDeleteDescription } from "@/pages/Stations/machineDeleteDescription";

import { stationCapabilityService } from "@/pages/StationCapabilities/service";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import { CapabilitiesEditSheet } from "@/pages/StationCapabilities/CapabilitiesEditSheet";
import { peripheralService } from "@/pages/PeripheralDevices/service";
import { peripheralKindLabels, type PeripheralDevice } from "@/pages/PeripheralDevices/types";
import { foldSearchText } from "@/lib/search-fold";
import { isVisibleStationKind } from "./visibleStationKinds";
import { buildStationMachineRows, type StationMachineRow } from "./stationMachineRows";
import { useStationsViewMode } from "./stationsViewMode";
import { StationsViewToggle } from "./StationsViewToggle";
import { StationListView } from "./StationListView";

// Perf: makinesiz kartlar için sabit boş dizi referansı (her render'da yeni `[]`
// StationCard'ın React.memo'sunu bozardı).
const EMPTY_MACHINES: Machine[] = [];

// Dışa aktarım ve LİSTE görünümü aynı düz satırlardan (`stationMachineRows.ts`): bir satır = bir MAKİNE,
// makinesiz istasyon `machine: null` ile tek satır.
type StationMachineExportRow = StationMachineRow;

// İstasyon düzeyindeki sayılar (özellik yeteneği) satır başına tekrarlandığı için
// `summable` DEĞİL — çok makineli istasyonda TOPLAM satırı onları kaç kez sayardı.
// Cihaz sayısı makineye özgüdür (her satırda bir kez) → toplanabilir.
const STATION_EXPORT_COLUMNS: ExportColumn<StationMachineExportRow>[] = [
  { label: "İstasyon Kodu", value: (r) => r.station.code },
  { label: "İstasyon", value: (r) => r.station.name },
  { label: "Görev Türü", value: (r) => stationKindLabels[r.station.kind] },
  { label: "Tip", value: (r) => stationTypeLabels[r.station.type] },
  { label: "Departman", value: (r) => r.station.department ?? "" },
  { label: "İstasyon Durumu", value: (r) => (r.station.isActive ? "Aktif" : "Pasif") },
  { label: "Renk Uygular", value: (r) => (r.station.appliesColor ? "Evet" : "Hayır") },
  { label: "Özellik Uygular", value: (r) => (r.station.appliesProperty ? "Evet" : "Hayır") },
  { label: "Kalite Kontrol Uygular", value: (r) => (r.station.appliesQuality ? "Evet" : "Hayır") },
  { label: "İstasyon Özellik Sayısı", value: (r) => r.propertyCount ?? "" },
  { label: "Makine Kodu", value: (r) => r.machine?.code ?? "" },
  { label: "Makine", value: (r) => r.machine?.name ?? "" },
  {
    label: "Makine Durumu",
    value: (r) => (r.machine ? (r.machine.isActive !== false ? "Aktif" : "Pasif") : "Makine yok"),
  },
  { label: "Cihaz Sayısı", value: (r) => (r.machine ? r.devices.length : ""), summable: true },
  {
    label: "Cihazlar",
    value: (r) => r.devices.map((d) => `${d.name} (${peripheralKindLabels[d.kind]})`).join(", "),
  },
];

// ⚠️ İSTEK GÖVDESİNİ ELLE KURAN HER KATMAN SESSİZ BİR ALLOWLIST'TİR
// (2026-08-13 dersi). 2026-09-03 taramasında ölçüldü: `appliesColor` ve
// `appliesProperty` kutuları formda vardı ama BURADAN GÖNDERİLMİYORDU — yani
// yetenek kutuları ÖLÜYDÜ (kaydet, hiçbir şey değişmez). Yeni bir alan
// eklerken bu satırı da ekle, yoksa kutu sessizce hiçbir şey yapmaz.
const buildStationPayload = (v: StationFormValues, initial: Station | null): Partial<Station> => ({
  // Kod backend'de üretilir (IST+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  type: v.type,
  kind: v.kind,
  department: v.department || null,
  isActive: v.isActive,
  appliesColor: v.appliesColor,
  appliesProperty: v.appliesProperty,
  appliesQuality: v.appliesQuality,
  producesWarpBeam: v.producesWarpBeam,
  consumesWarpBeam: v.consumesWarpBeam,
  defaultCategoryId: v.type === "EXTERNAL" ? v.defaultCategoryId ?? null : null,
});

const buildMachinePayload = (v: MachineFormValues, initial: Machine | null): Partial<Machine> => ({
  stationId: v.stationId,
  // Kod backend'de üretilir (MAK+GGAAYY+NNNN); create'te gönderilmez, edit'te korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  warpBeamSlots: v.warpBeamSlots,
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

  const stationsQ = useQuery({ queryKey: ["stations", "card"], queryFn: () => loadAllForPicker(stationService) });
  // showInactive → filtresiz yükle (pasif makineler de gelsin); aksi halde yalnız aktif.
  const machinesQ = useQuery({
    queryKey: ["machines", "card", showInactive],
    queryFn: () => loadAllForPicker(machineService, showInactive ? { filters: {} } : undefined),
  });
  const capsQ = useQuery({ queryKey: ["station-capabilities"], queryFn: () => stationCapabilityService.list() });
  // Makineye bağlı cihazlar (metre/yazıcı/tartı) — tek sorgu, makineId'ye gruplanır.
  // İstasyon kartındaki makine satırında genişletilerek gösterilir (Cihaz Kaydı'nın
  // makine-bazlı görünümü; merkezi kayıt Tanımlar→Donanım'da).
  const peripheralsQ = useQuery({
    queryKey: ["peripherals", "by-machine"],
    queryFn: () => loadAllForPicker(peripheralService, { filters: { isActive: "true" } }),
  });

  const stationMut = useCrudMutations({ service: stationService, queryKey: "stations", entityName: "İstasyon" });
  const machineMut = useCrudMutations({ service: machineService, queryKey: "machines", entityName: "Makine" });

  const [stationDlg, setStationDlg] = useState<{ open: boolean; initial: Station | null }>({ open: false, initial: null });
  const [machineDlg, setMachineDlg] = useState<{ open: boolean; initial: Machine | null; stationId?: string }>({ open: false, initial: null });
  const [capStation, setCapStation] = useState<StationCapabilitySummary | null>(null);
  const [qrMachine, setQrMachine] = useState<Machine | null>(null);
  const [deleteMachine, setDeleteMachine] = useState<Machine | null>(null);
  const [deactivateMachine, setDeactivateMachine] = useState<Machine | null>(null);

  // Perf: StationCard React.memo'lu — kart grid'i arama tuşuna basıldıkça yeniden
  // render OLMASIN diye handler prop'ları kararlı referans olmalı. (Diğer prop'lar
  // setState setter'ları — zaten kararlı — doğrudan geçilir.)
  const restoreMachine = machineMut.restoreMutation.mutate;
  const onEditStation = useCallback((st: Station) => setStationDlg({ open: true, initial: st }), []);
  const onAddMachine = useCallback(
    (sid: string) => setMachineDlg({ open: true, initial: null, stationId: sid }),
    [],
  );
  const onEditMachine = useCallback((m: Machine) => setMachineDlg({ open: true, initial: m }), []);
  const onReactivateMachine = useCallback((m: Machine) => restoreMachine(m.id), [restoreMachine]);

  // Tür kümesi formun şemasından TÜRETİLİR (`visibleStationKinds.ts`): sabit liste WEAVING'i
  // (ve sevkiyatı) düşürüyordu — kullanıcı istasyonu kaydediyor, kart çizilmiyordu (2026-09-16).
  const dokumaEnabled = useDokumaEnabled();
  const allStations = useMemo(
    () => (stationsQ.data?.data ?? []).filter((s) => isVisibleStationKind(s.kind, { dokumaEnabled })),
    [stationsQ.data, dokumaEnabled],
  );
  const capByStation = useMemo(
    () => new Map((capsQ.data?.data ?? []).map((c) => [c.stationId, c])),
    [capsQ.data],
  );
  const peripheralsByMachine = useMemo(() => {
    const map = new Map<string, PeripheralDevice[]>();
    for (const p of peripheralsQ.data?.data ?? []) {
      if (!p.machineId) continue;
      const list = map.get(p.machineId) ?? [];
      list.push(p);
      map.set(p.machineId, list);
    }
    return map;
  }, [peripheralsQ.data]);
  const machinesByStation = useMemo(() => {
    const map = new Map<string, Machine[]>();
    for (const m of machinesQ.data?.data ?? []) {
      const list = map.get(m.stationId);
      if (list) list.push(m);
      else map.set(m.stationId, [m]);
    }
    return map;
  }, [machinesQ.data]);

  // İstemci-tarafı filtre — tüm veri zaten yüklü (loadAllForPicker). AND (boyutlar
  // arası) + OR (Tür chip'leri içinde). showInactive filtre DEĞİL, makine yüklemesini sürer.
  const stations = useMemo(() => {
    const q = foldSearchText(debouncedSearch);
    return allStations.filter((s) => {
      if (stationId !== "__all__" && s.id !== stationId) return false;

      const sm = machinesByStation.get(s.id) ?? [];
      if (machinePresence === "has" && sm.length === 0) return false;
      if (machinePresence === "none" && sm.length > 0) return false;
      if (machinePresence === "active" && !sm.some((m) => m.isActive !== false)) return false;

      if (q) {
        const hay = foldSearchText(
          [s.name, s.code, s.department ?? "", ...sm.flatMap((m) => [m.name, m.code])].join(" "),
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allStations, stationId, machinePresence, debouncedSearch, machinesByStation]);

  // Düz satırlar — EKRANDA GÖRÜNEN istasyon kümesinden (filtre sonrası); liste görünümü VE dışa
  // aktarım bu tek kümeden çizilir (görünümden bağımsız dosya). Makinesiz istasyon tek satır.
  const exportRows = useMemo<StationMachineExportRow[]>(
    () => buildStationMachineRows(stations, machinesByStation, peripheralsByMachine, capByStation),
    [stations, machinesByStation, peripheralsByMachine, capByStation],
  );
  // Görünüm tercihi (kart ⇄ liste) — varsayılan liste, cihaza kayıtlı (`stationsViewMode.ts`).
  const [viewMode, setViewMode] = useStationsViewMode();

  const anyFilterActive =
    debouncedSearch.trim() !== "" || stationId !== "__all__" || machinePresence !== "all";

  const clearFilters = () => {
    setSearch("");
    setStationId("__all__");
    setMachinePresence("all");
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

  // Silme önizlemesi — modal açıldığında (deleteMachine set) çekilir. Üretim izi ya da
  // oturum geçmişi varsa deletable=false → onay pasif.
  const deletePreviewQ = useQuery({
    queryKey: ["machine-delete-preview", deleteMachine?.id],
    queryFn: () => getMachineDeletePreview(deleteMachine!.id),
    enabled: !!deleteMachine,
  });
  const preview = deletePreviewQ.data;
  const deleteDescription = deleteMachine
    ? buildMachineDeleteDescription(deleteMachine.name, preview, deletePreviewQ.isLoading)
    : undefined;

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
    <PageShell>
      <PageHeader
        title="Üretim İstasyonları"
        actions={
          <div className="flex gap-2">
            <StationsViewToggle mode={viewMode} onChange={setViewMode} />
            <ListExportMenu
              name="Üretim İstasyonları"
              rows={exportRows}
              columns={STATION_EXPORT_COLUMNS}
              // undefined → ListExportMenu kendi "İndirilecek kayıt yok" ipucunu verir.
              title={exportRows.length > 0 ? "Ekrandaki istasyon + makine listesini indir" : undefined}
              notes={[
                `Ekranda görünen ${stations.length} istasyon (toplam ${allStations.length}) — filtreler uygulanmış hâliyle.`,
                "Satır başına bir MAKİNE; istasyon sütunları tekrarlanır. Makinesi olmayan istasyon tek satırla gelir (makine sütunları boş, durum \"Makine yok\").",
                showInactive
                  ? "Pasif makineler de listede."
                  : "Yalnız AKTİF makineler — pasifler listede gizli (\"Pasifleri göster\" ile açılır).",
                "Formda seçilebilen her görev türü listede (dokuma tezgahı yalnız dokuma modülü açıkken); liste ve kart görünümü aynı kümeyi verir.",
                "\"İstasyon Özellik Sayısı\" istasyon düzeyindedir (her makine satırında tekrarlanır) — TOPLAM satırına girmez.",
                "Cihaz sütunları yalnız AKTİF donanım kayıtlarını sayar.",
              ]}
            />
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
        stationOptions={allStations.map((s) => ({ id: s.id, name: s.name }))}
        visibleCount={stations.length}
        totalCount={allStations.length}
        anyFilterActive={anyFilterActive}
        onClear={clearFilters}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive((v) => !v)}
      />

      <PageBody className="p-6">
        {loading && <Skeleton className="h-24 w-full" />}
        {!loading && allStations.length === 0 && (
          <div className="text-sm text-muted-foreground">Üretim istasyonu yok.</div>
        )}
        {!loading && allStations.length > 0 && stations.length === 0 && (
          <div className="text-sm text-muted-foreground">Filtreye uyan istasyon yok.</div>
        )}
        {stations.length > 0 && viewMode === "list" && (
          <StationListView
            rows={exportRows}
            canWrite={canWrite}
            onEditStation={onEditStation}
            onAddMachine={onAddMachine}
            machine={{ onEdit: onEditMachine, onQr: setQrMachine, onDeactivate: setDeactivateMachine, onReactivate: onReactivateMachine, onDelete: setDeleteMachine }}
          />
        )}
        {stations.length > 0 && viewMode === "cards" && (
          // Responsive kart grid'i — sütun sayısı mevcut genişliğe göre otomatik
          // (auto-fill, kart başına min 28rem/448px → makine tablosu rahat sığar).
          // items-start: kısa kartlar aynı satırdaki uzun karta göre uzamaz.
          <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(28rem,1fr))]">
            {stations.map((s) => (
              <StationCard
                key={s.id}
                station={s}
                machines={machinesByStation.get(s.id) ?? EMPTY_MACHINES}
                peripheralsByMachine={peripheralsByMachine}
                cap={capByStation.get(s.id)}
                canWrite={canWrite}
                onEditStation={onEditStation}
                onAddMachine={onAddMachine}
                onEditMachine={onEditMachine}
                onQrMachine={setQrMachine}
                onDeactivateMachine={setDeactivateMachine}
                onReactivateMachine={onReactivateMachine}
                onDeleteMachine={setDeleteMachine}
                onEditCap={setCapStation}
              />
            ))}
          </div>
        )}
      </PageBody>

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
    </PageShell>
  );
}
