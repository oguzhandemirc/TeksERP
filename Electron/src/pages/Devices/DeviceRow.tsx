import {
  Unlink,
  Power,
  PowerOff,
  MoreHorizontal,
  Trash2,
  CheckCircle2,
  History,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
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
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { safeFormat } from "@/lib/format";
import type { DeviceListItem } from "./types";

export const deviceKindLabel = (k: string) => (k === "PHONE" ? "Telefon" : k === "DESKTOP" ? "PC" : "Tablet");

interface DeviceAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  device: DeviceListItem;
  onAssign: () => void;
  onRevoke: () => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  isPending: boolean;
}

/** Cihaz listesinin bir satırı (klasik tablo) — ⋯ menü + sağ-tık aynı aksiyonlar. */
export function DeviceRow({
  device,
  onAssign,
  onRevoke,
  onDeactivate,
  onReactivate,
  onDelete,
  isPending,
}: Props) {
  const { hasPermission } = useRoleAccess();
  const openTarget = useOpenTarget();
  const canManage = hasPermission("admin:settings");
  const approved = device.status === "APPROVED";
  const lastSeen = device.lastSeenAt ? safeFormat(device.lastSeenAt, "dd.MM.yyyy HH:mm") : "—";
  const detailPath = `/access/devices/${device.id}`;

  const actions: DeviceAction[] = [
    { key: "detail", label: "İşlem Dökümü / Detay", icon: History, onClick: () => openTarget(detailPath) },
    { key: "assign", label: approved ? "Türü Değiştir" : "Onayla", icon: CheckCircle2, onClick: onAssign },
    approved && { key: "revoke", label: "Onayı Geri Al", icon: Unlink, onClick: onRevoke },
    device.isActive
      ? { key: "deactivate", label: "Pasife Al", icon: PowerOff, onClick: onDeactivate, danger: true }
      : { key: "reactivate", label: "Aktifleştir", icon: Power, onClick: onReactivate },
    { key: "delete", label: "Kalıcı Olarak Sil", icon: Trash2, onClick: onDelete, danger: true },
  ].filter(Boolean) as DeviceAction[];

  const row = (
    <TableRow className={device.isActive ? undefined : "opacity-60"}>
      <TableCell className="py-2">
        <button
          type="button"
          className="truncate font-medium hover:underline"
          title="İşlem dökümü / detay"
          onClick={(e) => openTarget(detailPath, e)}
          onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openTarget(detailPath, e); } }}
        >
          {device.name}
        </button>
      </TableCell>
      <TableCell className="py-2 text-muted-foreground">{deviceKindLabel(device.kind)}</TableCell>
      <TableCell className="py-2">
        {!device.isActive ? (
          <Badge variant="muted">Pasif</Badge>
        ) : approved ? (
          <Badge>Onaylı</Badge>
        ) : (
          <Badge variant="muted">Onay bekliyor</Badge>
        )}
      </TableCell>
      <TableCell className="py-2 text-xs text-muted-foreground">{lastSeen}</TableCell>
      <TableCell className="py-2 font-mono text-xs text-muted-foreground">{device.deviceId.slice(0, 12)}…</TableCell>
      <TableCell className="py-2 text-right">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isPending}>
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
      </TableCell>
    </TableRow>
  );

  if (!canManage) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((a) => (
          <ContextMenuItem
            key={a.key}
            onSelect={a.onClick}
            disabled={isPending}
            className={a.danger ? "text-destructive focus:text-destructive" : undefined}
          >
            <a.icon /> {a.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
