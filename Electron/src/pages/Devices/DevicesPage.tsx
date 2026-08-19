import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RefreshButton } from "@/components/RefreshButton";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";
import { ApproveAssignDialog } from "./ApproveAssignDialog";
import { DeviceRow } from "./DeviceRow";
import {
  DeviceFilterBar,
  type DeviceKindFilter,
  type DeviceStatusFilter,
} from "./DeviceFilterBar";
import { foldSearchText } from "@/lib/search-fold";

const QUERY_KEY = "admin-devices";

export function DevicesPage() {
  const qc = useQueryClient();
  const [assignTarget, setAssignTarget] = useState<DeviceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceListItem | null>(null);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>("all");
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
      if (kindFilter !== "all" && d.kind !== kindFilter) return false;
      if (q && !foldSearchText(`${d.name} ${d.deviceId}`).includes(q)) return false;
      return true;
    });
  }, [devices, statusFilter, kindFilter, debouncedSearch]);

  const anyFilterActive = debouncedSearch.trim() !== "" || statusFilter !== "all" || kindFilter !== "all";
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setKindFilter("all"); };
  const rowPending = revoke.isPending || deactivate.isPending || reactivate.isPending || hardDelete.isPending;

  return (
    <PageShell>
      <PageHeader
        title="Cihazlar"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
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
        resultCount={filtered.length}
        totalCount={devices.length}
        anyFilterActive={anyFilterActive}
        onClear={clearFilters}
      />

      <PageBody className="p-6">
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

function EmptyState() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-2 text-lg font-medium">Henüz cihaz yok</div>
      <p className="text-sm text-muted-foreground">
        Tablet ilk açıldığında kendini otomatik bildirir ve burada "Onay bekliyor" olarak listelenir.
        Onaylayıp bir makineye atayınca tablet çalışmaya başlar.
      </p>
    </div>
  );
}
