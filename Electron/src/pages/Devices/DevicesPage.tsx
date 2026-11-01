import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";
import { ApproveAssignDialog } from "./ApproveAssignDialog";
import { TabletTlsQrButton } from "./TabletTlsQrButton";
import { RebindRequestsPanel } from "./RebindRequestsPanel";
import { DuplicateCandidates } from "./DuplicateCandidates";
import { ProofLostPanel } from "./ProofLostPanel";
import { PendingBulkReject } from "./PendingBulkReject";
import { DevicesEmptyState as EmptyState } from "./DevicesEmptyState";
import { useProofLost } from "./proof";
import { DeviceRow, deviceKindLabel } from "./DeviceRow";
import {
  DeviceFilterBar,
  type DeviceKindFilter,
  type DeviceStatusFilter,
} from "./DeviceFilterBar";
import { foldSearchText } from "@/lib/search-fold";

const QUERY_KEY = "admin-devices";

/** Satırdaki rozetle AYNI sıra: pasiflik onay durumunun önüne geçer. */
const deviceStatusLabel = (d: DeviceListItem): string =>
  !d.isActive ? "Pasif" : d.status === "APPROVED" ? "Onaylı" : "Onay bekliyor";

// Dışa aktarım sütunları — ekrandaki kolonların (Cihaz · Tür · Durum · Son
// aktivite · Kimlik) karşılığı; kimlik tabloda kısaltılır, dosyada TAM yazılır
// (cihaz eşleştirmesi ancak tam kimlikle yapılabilir).
const DEVICE_EXPORT_COLUMNS: ExportColumn<DeviceListItem>[] = [
  { label: "Cihaz Adı", value: (d) => d.name },
  { label: "Tür", value: (d) => deviceKindLabel(d.kind) },
  { label: "Durum", value: deviceStatusLabel },
  { label: "Makine", value: (d) => (d.machine ? `${d.machine.name} (${d.machine.code})` : "") },
  { label: "İstasyon", value: (d) => d.machine?.station.name ?? "" },
  { label: "Son Aktivite", value: (d) => (d.lastSeenAt ? safeFormat(d.lastSeenAt, "dd.MM.yyyy HH:mm") : "") },
  { label: "Cihaz Kimliği", value: (d) => d.deviceId },
];

export function DevicesPage() {
  const qc = useQueryClient();
  const [assignTarget, setAssignTarget] = useState<DeviceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceListItem | null>(null);

  // Komut paleti derin bağlantısı `?kopya=1`: kopya şeridi açık gelir.
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  // `?kanit=1` (bildirim/komut paleti): anahtar kaybı süzgeci + bant açık gelir.
  const kanitLink = params.get("kanit") === "1";
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>(kanitLink ? "proof-lost" : "all");
  // Sekme sayfayı canlı tutar: sayfa açıkken gelen derin bağlantı da süzgeci uygulamalı.
  useEffect(() => { if (kanitLink) setStatusFilter("proof-lost"); }, [kanitLink]);
  const [kindFilter, setKindFilter] = useState<DeviceKindFilter>("all");

  const query = useQuery({ queryKey: [QUERY_KEY], queryFn: deviceService.list });
  const invalidate = () => void qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  const revoke = useMutation({
    mutationFn: deviceService.revoke,
    onSuccess: () => { toast.success("Onay geri alındı (cihaz onay bekliyor)"); invalidate(); },
  });
  const deactivate = useMutation({
    mutationFn: deviceService.deactivate,
    onSuccess: () => { toast.success("Cihaz pasife alındı"); invalidate(); },
  });
  const reactivate = useMutation({
    mutationFn: deviceService.reactivate,
    onSuccess: () => { toast.success("Cihaz aktifleştirildi"); invalidate(); },
  });
  const hardDelete = useMutation({
    mutationFn: deviceService.hardDelete,
    onSuccess: () => { toast.success("Cihaz kalıcı olarak silindi"); setDeleteTarget(null); invalidate(); },
  });

  const devices = useMemo(() => query.data?.data ?? [], [query.data]);
  const proofLost = useProofLost();
  const proofLostIds = useMemo(() => new Set((proofLost.data?.cihazlar ?? []).map((d) => d.id)), [proofLost.data]);
  const pendingCount = useMemo(
    () => devices.filter((d) => d.isActive && d.status === "PENDING").length,
    [devices],
  );

  const filtered = useMemo(() => {
    const q = foldSearchText(debouncedSearch);
    return devices.filter((d) => {
      if (statusFilter === "pending" && !(d.isActive && d.status === "PENDING")) return false;
      if (statusFilter === "approved" && !(d.isActive && d.status === "APPROVED")) return false;
      if (statusFilter === "inactive" && d.isActive) return false;
      if (statusFilter === "proof-lost" && !proofLostIds.has(d.id)) return false;
      if (kindFilter !== "all" && d.kind !== kindFilter) return false;
      if (q && !foldSearchText(`${d.name} ${d.deviceId}`).includes(q)) return false;
      return true;
    });
  }, [devices, statusFilter, kindFilter, debouncedSearch, proofLostIds]);

  const anyFilterActive = debouncedSearch.trim() !== "" || statusFilter !== "all" || kindFilter !== "all";
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setKindFilter("all"); };
  const rowPending = revoke.isPending || deactivate.isPending || reactivate.isPending || hardDelete.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Cihazlar"
        actions={
          <>
            <TabletTlsQrButton />
            <RefreshButton queryKey={QUERY_KEY} />
            <ListExportMenu
              name="Cihazlar"
              rows={filtered}
              columns={DEVICE_EXPORT_COLUMNS}
              notes={[
                "Liste ekrandaki arama · durum · tür filtresine göredir.",
                anyFilterActive
                  ? `Filtre etkin: ${filtered.length} / ${devices.length} cihaz.`
                  : "Filtre yok — tüm cihazlar (pasifler dahil).",
              ]}
            />
          </>
        }
      />

      <DeviceFilterBar
        search={search}
        onSearch={setSearch}
        status={statusFilter}
        onStatus={setStatusFilter}
        kind={kindFilter}
        onKind={setKindFilter}
        pendingCount={pendingCount}
        onShowPending={() => setStatusFilter("pending")}
        proofLostCount={proofLostIds.size}
        resultCount={filtered.length}
        totalCount={devices.length}
        anyFilterActive={anyFilterActive}
        onClear={clearFilters}
      />

      <PageBody className="space-y-4 p-6">
        <ProofLostPanel initiallyOpen={kanitLink} />
        <RebindRequestsPanel devices={devices} />
        <PendingBulkReject devices={devices} onDone={invalidate} />
        <DuplicateCandidates initiallyOpen={params.get("kopya") === "1"} />
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : devices.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="rounded-md border">
            <Table containerClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Cihaz</TableHead>
                  <TableHead className="w-24">Tür</TableHead>
                  <TableHead className="w-36">Durum</TableHead>
                  <TableHead className="w-40">Son aktivite</TableHead>
                  <TableHead className="w-40">Kimlik</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Filtreye uyan cihaz yok.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((d) => (
                    <DeviceRow
                      key={d.id}
                      device={d}
                      onAssign={() => setAssignTarget(d)}
                      onRevoke={() => revoke.mutate(d.id)}
                      onDeactivate={() => deactivate.mutate(d.id)}
                      onReactivate={() => reactivate.mutate(d.id)}
                      onDelete={() => setDeleteTarget(d)}
                      isPending={rowPending}
                      proofLost={proofLostIds.has(d.id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>

      <ApproveAssignDialog
        device={assignTarget}
        onOpenChange={(open) => { if (!open) setAssignTarget(null); }}
        onDone={() => { setAssignTarget(null); invalidate(); }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Cihazı kalıcı olarak sil"
        description={deleteTarget ? `"${deleteTarget.name}" cihazı listeden tamamen kaldırılacak. Aynı tablet tekrar açılırsa yeni kayıt oluşur. Bu işlem geri alınamaz.` : undefined}
        confirmLabel="Kalıcı olarak sil"
        destructive
        isPending={hardDelete.isPending}
        onConfirm={() => { if (deleteTarget) hardDelete.mutate(deleteTarget.id); }}
      />
    </PageShell>
  );
}
