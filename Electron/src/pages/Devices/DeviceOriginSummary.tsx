import { safeFormat } from "@/lib/format";
import type { DeviceListItem } from "./types";

const HW_SOURCE_LABELS: Record<string, string> = {
  ANDROID_ID: "Android cihaz kimliği",
  WIN_MACHINE_GUID: "Windows makine kimliği",
  MAC_PLATFORM_UUID: "Mac donanım kimliği",
  LINUX_MACHINE_ID: "Linux makine kimliği",
};

/** Onay öncesi "bu cihaz nereden geldi": kaynak adres, ilk görülme, donanım özeti (VDS O3). */
export function DeviceOriginSummary({ device }: { device: Pick<DeviceListItem, "announcedFrom" | "createdAt" | "hwSource"> }) {
  const hw = device.hwSource ? (HW_SOURCE_LABELS[device.hwSource] ?? device.hwSource) : "Donanım özeti yok";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 text-xs" data-testid="device-origin">
      <dt className="text-muted-foreground">Geldiği adres</dt>
      <dd className="font-mono">{device.announcedFrom ?? "Bilinmiyor"}</dd>
      <dt className="text-muted-foreground">İlk görülme</dt>
      <dd>{safeFormat(device.createdAt, "dd.MM.yyyy HH:mm")}</dd>
      <dt className="text-muted-foreground">Donanım</dt>
      <dd>{hw}</dd>
    </dl>
  );
}
