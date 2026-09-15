// =============================================================================
// İstasyon + makine DÜZ SATIRLARI — liste görünümü ve dışa aktarım AYNI kümeden (tek kaynak)
// =============================================================================
// Bir satır = bir MAKİNE, istasyon sütunları tekrarlanır (denormalize). Makinesi olmayan istasyon
// `machine: null` ile TEK satır — aksi hâlde listeden ve dosyadan SESSİZCE düşerdi.
// =============================================================================
import type { Station } from "./types";
import type { Machine } from "@/pages/Machines/types";
import type { PeripheralDevice } from "@/pages/PeripheralDevices/types";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";

export interface StationMachineRow {
  station: Station;
  machine: Machine | null;
  /** Bu makineye bağlı AKTİF cihazlar (metre/yazıcı/tartı). */
  devices: PeripheralDevice[];
  /** İstasyonun özellik yeteneği sayısı (istasyon düzeyi — satır başına TEKRARLANIR). */
  propertyCount: number | null;
}

export function buildStationMachineRows(
  stations: readonly Station[],
  machinesByStation: ReadonlyMap<string, Machine[]>,
  peripheralsByMachine: ReadonlyMap<string, PeripheralDevice[]>,
  capByStation: ReadonlyMap<string, StationCapabilitySummary>,
): StationMachineRow[] {
  return stations.flatMap((s): StationMachineRow[] => {
    const propertyCount = capByStation.get(s.id)?.propertyCount ?? null;
    const sm = machinesByStation.get(s.id) ?? [];
    if (sm.length === 0) return [{ station: s, machine: null, devices: [], propertyCount }];
    return sm.map((m) => ({ station: s, machine: m, devices: peripheralsByMachine.get(m.id) ?? [], propertyCount }));
  });
}
