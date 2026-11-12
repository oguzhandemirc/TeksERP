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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import type { DeviceListItem } from "./types";

export const deviceKindLabel = (k: string) => (k === "PHONE" ? "Telefon" : k === "DESKTOP" ? "PC" : "Tablet");

interface DeviceAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

/** Satır eylemlerinin sayfa tarafı — cihazı alır (sütunlar bir kez kurulur, geri çağrılar ref'ten okunur). */
export interface DeviceRowHandlers {
  onAssign: (d: DeviceListItem) => void;
  onRevoke: (d: DeviceListItem) => void;
  onDeactivate: (d: DeviceListItem) => void;
  onReactivate: (d: DeviceListItem) => void;
  onDelete: (d: DeviceListItem) => void;
  isPending: boolean;
}

/** ⋯ menü ve sağ-tık AYNI eylem listesi. */
function deviceActions(device: DeviceListItem, h: DeviceRowHandlers, openDetail: () => void): DeviceAction[] {
  const approved = device.status === "APPROVED";
  return [
    { key: "detail", label: "İşlem Dökümü / Detay", icon: History, onClick: openDetail },
    { key: "assign", label: approved ? "Türü Değiştir" : "Onayla", icon: CheckCircle2, onClick: () => h.onAssign(device) },
    approved && { key: "revoke", label: "Onayı Geri Al", icon: Unlink, onClick: () => h.onRevoke(device) },
    device.isActive
      ? { key: "deactivate", label: "Pasife Al", icon: PowerOff, onClick: () => h.onDeactivate(device), danger: true }
      : { key: "reactivate", label: "Aktifleştir", icon: Power, onClick: () => h.onReactivate(device) },
    { key: "delete", label: "Kalıcı Olarak Sil", icon: Trash2, onClick: () => h.onDelete(device), danger: true },
  ].filter(Boolean) as DeviceAction[];
}

export const deviceDetailPath = (d: DeviceListItem) => `/access/devices/${d.id}`;

/** Cihaz adı — işlem dökümünü açar (Ctrl/⌘/orta tık → yeni sekme). */
export function DeviceNameLink({ device }: { device: DeviceListItem }) {
  const openTarget = useOpenTarget();
  const path = deviceDetailPath(device);
  return (
    <button
      type="button"
      className="truncate font-medium hover:underline"
      title="İşlem dökümü / detay"
      onClick={(e) => openTarget(path, e)}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openTarget(path, e); } }}
    >
      {device.name}
    </button>
  );
}

/** Satır sonundaki ⋯ menü — yalnız `admin:settings`. */
export function DeviceActionsMenu({ device, handlers }: { device: DeviceListItem; handlers: DeviceRowHandlers }) {
  const { hasPermission } = useRoleAccess();
  const openTarget = useOpenTarget();
  if (!hasPermission("admin:settings")) return null;
  const actions = deviceActions(device, handlers, () => openTarget(deviceDetailPath(device)));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={handlers.isPending} aria-label="Cihaz eylemleri">
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
  );
}

/** Sağ-tık menüsünün öğeleri (DataTable `rowContextMenu`); izin yoksa sayfa menüyü hiç vermez. */
export function DeviceContextItems({ device, handlers }: { device: DeviceListItem; handlers: DeviceRowHandlers }) {
  const openTarget = useOpenTarget();
  const actions = deviceActions(device, handlers, () => openTarget(deviceDetailPath(device)));
  return (
    <>
      {actions.map((a) => (
        <ContextMenuItem
          key={a.key}
          onSelect={a.onClick}
          disabled={handlers.isPending}
          className={a.danger ? "text-destructive focus:text-destructive" : undefined}
        >
          <a.icon /> {a.label}
        </ContextMenuItem>
      ))}
    </>
  );
}

/** Durum rozeti (+ anahtar kaybı) — tek satır. */
export function DeviceStatusCell({ device, proofLost }: { device: DeviceListItem; proofLost: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {device.mergedIntoId ? (
        <Badge variant="muted" title="Ana kayda birleştirildi; geri almak için detaya girin">Birleştirildi</Badge>
      ) : !device.isActive ? (
        <Badge variant="muted">Pasif</Badge>
      ) : device.status === "APPROVED" ? (
        <Badge>Onaylı</Badge>
      ) : (
        <Badge variant="muted">Onay bekliyor</Badge>
      )}
      {proofLost && (
        <Badge
          className="border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
          title="Cihazın kimlik anahtarı kayıp; sayfanın üstündeki Anahtar kaybı bölümünden yeniden bağlayın"
        >
          Anahtar kaybı
        </Badge>
      )}
    </span>
  );
}
