import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Unlink,
  Power,
  PowerOff,
  MoreHorizontal,
  Trash2,
  KeyRound,
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
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { safeFormat } from "@/lib/format";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";
import { PairingCodeDialog } from "./PairingCodeDialog";

const QUERY_KEY = "admin-devices";

interface PairingDefaults {
  machineId?: string;
  deviceName?: string;
}

export function DevicesPage() {
  const qc = useQueryClient();
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingDefaults, setPairingDefaults] = useState<PairingDefaults | undefined>(
    undefined
  );
  const [deleteTarget, setDeleteTarget] = useState<DeviceListItem | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: deviceService.list,
  });

  const unpair = useMutation({
    mutationFn: deviceService.unpair,
    onSuccess: () => {
      toast.success("Cihaz eşleşmesi kaldırıldı");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const deactivate = useMutation({
    mutationFn: deviceService.deactivate,
    onSuccess: () => {
      toast.success("Cihaz pasife alındı");
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const reactivate = useMutation({
    mutationFn: deviceService.reactivate,
    onSuccess: (res) => {
      toast.success(
        res.data.machineId
          ? "Cihaz aktifleştirildi — eski eşleşmesiyle çalışmaya devam edebilir"
          : "Cihaz aktifleştirildi — yeni eşleştirme kodu gerekir"
      );
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const hardDelete = useMutation({
    mutationFn: deviceService.hardDelete,
    onSuccess: () => {
      toast.success("Cihaz kalıcı olarak silindi");
      setDeleteTarget(null);
      void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });

  const openPairing = (defaults?: PairingDefaults) => {
    setPairingDefaults(defaults);
    setPairingOpen(true);
  };

  const devices = query.data?.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Cihazlar"
        description="Sahadaki tabletler ve eşleşmeli oldukları makineler."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={QUERY_KEY} />
            <PermissionGate permission="admin:settings">
              <Button onClick={() => openPairing()} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Yeni Eşleştirme Kodu
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : devices.length === 0 ? (
          <EmptyState onCreate={() => openPairing()} />
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                onGenerateCode={() => openPairing({ deviceName: d.name })}
                onUnpair={() => unpair.mutate(d.id)}
                onDeactivate={() => deactivate.mutate(d.id)}
                onReactivate={() => reactivate.mutate(d.id)}
                onDelete={() => setDeleteTarget(d)}
                isPending={
                  unpair.isPending ||
                  deactivate.isPending ||
                  reactivate.isPending ||
                  hardDelete.isPending
                }
              />
            ))}
          </div>
        )}
      </div>

      <PairingCodeDialog
        open={pairingOpen}
        onOpenChange={setPairingOpen}
        onCreated={() => void qc.invalidateQueries({ queryKey: [QUERY_KEY] })}
        defaults={pairingDefaults}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Cihazı kalıcı olarak sil"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" cihazı listeden tamamen kaldırılacak. Aynı tablet tekrar eşleşirse yeni kayıt oluşturulur. Bu işlem geri alınamaz.`
            : undefined
        }
        confirmLabel="Kalıcı olarak sil"
        destructive
        isPending={hardDelete.isPending}
        onConfirm={() => {
          if (deleteTarget) hardDelete.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}

function DeviceRow({
  device,
  onGenerateCode,
  onUnpair,
  onDeactivate,
  onReactivate,
  onDelete,
  isPending,
}: {
  device: DeviceListItem;
  onGenerateCode: () => void;
  onUnpair: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const paired = !!device.machine;
  const lastSeen = device.lastSeenAt
    ? safeFormat(device.lastSeenAt, "dd.MM.yyyy HH:mm")
    : "—";
  const canGenerateCode = device.isActive && !paired;
  const canDelete = !paired;

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{device.name}</span>
            {device.isActive ? (
              paired ? (
                <Badge>Eşleşmeli</Badge>
              ) : (
                <Badge variant="muted">Eşleşmemiş</Badge>
              )
            ) : (
              <Badge variant="muted">Pasif</Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {paired && device.machine ? (
              <span>
                <span className="font-medium text-foreground">
                  {device.machine.code} — {device.machine.name}
                </span>{" "}
                · {device.machine.station.name}
              </span>
            ) : (
              <span className="italic">Henüz makineye eşlenmemiş</span>
            )}
            <span>Son aktivite: {lastSeen}</span>
            <span className="font-mono">{device.deviceId.slice(0, 12)}…</span>
          </div>
        </div>
        <PermissionGate permission="admin:settings">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={isPending}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canGenerateCode && (
                <DropdownMenuItem onClick={onGenerateCode}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Yeni Kod Üret
                </DropdownMenuItem>
              )}
              {paired && (
                <DropdownMenuItem onClick={onUnpair}>
                  <Unlink className="mr-2 h-4 w-4" />
                  Eşleşmeyi Kaldır
                </DropdownMenuItem>
              )}
              {device.isActive ? (
                <DropdownMenuItem onClick={onDeactivate} className="text-destructive">
                  <PowerOff className="mr-2 h-4 w-4" />
                  Pasife Al
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onReactivate}>
                  <Power className="mr-2 h-4 w-4" />
                  Aktifleştir
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Kalıcı Olarak Sil
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-2 text-lg font-medium">Henüz cihaz yok</div>
      <p className="mb-4 text-sm text-muted-foreground">
        Tablet ilk eşleşmede otomatik kayıt olur. Yeni bir tabletin makineye bağlanması için
        eşleştirme kodu üretin ve tabletteki "Cihaz Eşleştir" ekranına girin.
      </p>
      <PermissionGate permission="admin:settings">
        <Button onClick={onCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          İlk Eşleştirme Kodunu Üret
        </Button>
      </PermissionGate>
    </div>
  );
}
