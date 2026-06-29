import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Unlink,
  Power,
  PowerOff,
  MoreHorizontal,
  Trash2,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { RefreshButton } from "@/components/RefreshButton";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";
import { ApproveAssignDialog } from "./ApproveAssignDialog";

const QUERY_KEY = "admin-devices";

export function DevicesPage() {
  const qc = useQueryClient();
  const [assignTarget, setAssignTarget] = useState<DeviceListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceListItem | null>(null);

  const query = useQuery({ queryKey: [QUERY_KEY], queryFn: deviceService.list });
  const invalidate = () => void qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  const revoke = useMutation({
    mutationFn: deviceService.revoke,
    onSuccess: () => { toast.success("Atama geri alındı (cihaz onay bekliyor)"); invalidate(); },
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

  const devices = query.data?.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cihazlar"
        description="Sahadaki tabletler — kendilerini bildirir, yönetici onaylar + makineye atar."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <div className="flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : devices.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                onAssign={() => setAssignTarget(d)}
                onRevoke={() => revoke.mutate(d.id)}
                onDeactivate={() => deactivate.mutate(d.id)}
                onReactivate={() => reactivate.mutate(d.id)}
                onDelete={() => setDeleteTarget(d)}
                isPending={revoke.isPending || deactivate.isPending || reactivate.isPending || hardDelete.isPending}
              />
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}

interface DeviceAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

function DeviceRow({
  device, onAssign, onRevoke, onDeactivate, onReactivate, onDelete, isPending,
}: {
  device: DeviceListItem;
  onAssign: () => void;
  onRevoke: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const { hasPermission } = useRoleAccess();
  const canManage = hasPermission("admin:settings");
  const approved = device.status === "APPROVED";
  const assigned = !!device.machine;
  const lastSeen = device.lastSeenAt ? safeFormat(device.lastSeenAt, "dd.MM.yyyy HH:mm") : "—";

  const actions: DeviceAction[] = [
    { key: "assign", label: approved ? "Yeniden Ata" : "Onayla & Ata", icon: CheckCircle2, onClick: onAssign },
    approved && { key: "revoke", label: "Atamayı Geri Al", icon: Unlink, onClick: onRevoke },
    device.isActive
      ? { key: "deactivate", label: "Pasife Al", icon: PowerOff, onClick: onDeactivate, danger: true }
      : { key: "reactivate", label: "Aktifleştir", icon: Power, onClick: onReactivate },
    !assigned && { key: "delete", label: "Kalıcı Olarak Sil", icon: Trash2, onClick: onDelete, danger: true },
  ].filter(Boolean) as DeviceAction[];

  const card = (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{device.name}</span>
            {!device.isActive ? (
              <Badge variant="muted">Pasif</Badge>
            ) : approved ? (
              <Badge>Onaylı</Badge>
            ) : (
              <Badge variant="muted">Onay bekliyor</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {assigned && device.machine ? (
              <span>
                <span className="font-medium text-foreground">{device.machine.code} — {device.machine.name}</span>
                {" "}· {device.machine.station.name}
              </span>
            ) : (
              <span className="italic">Henüz makineye atanmamış</span>
            )}
            <span>Son aktivite: {lastSeen}</span>
            <span className="font-mono">{device.deviceId.slice(0, 12)}…</span>
          </div>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={isPending}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((a) => (
                <DropdownMenuItem key={a.key} onClick={a.onClick} className={a.danger ? "text-destructive" : undefined}>
                  <a.icon className="mr-2 h-4 w-4" />
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardContent>
    </Card>
  );

  if (!canManage) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a) => (
          <ContextMenuItem key={a.key} onSelect={a.onClick} disabled={isPending} className={a.danger ? "text-destructive focus:text-destructive" : undefined}>
            <a.icon /> {a.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
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
