// =============================================================================
// İstasyon LİSTE ÖĞELERİ — liste görünümü ve dışa aktarım AYNI kümeden (tek kaynak)
// =============================================================================
// Bir öğe = bir İSTASYON; makineleri öğenin içinde taşınır (eskiden satır = makine idi, çok makineli
// istasyon listede tekrarlanıyordu). Kurşun bilgisi yalnız kurşun açılabilen istasyonlar için gelir.
// =============================================================================
import type { Station } from "./types";
import type { Machine } from "@/pages/Machines/types";
import type { PeripheralDevice } from "@/pages/PeripheralDevices/types";
import type { StationCapabilitySummary } from "@/pages/StationCapabilities/types";
import type { KursunStationDto } from "./kursun-station";
import { StationKind } from "@/types/enums";

/** Listedeki kurşun özeti; `null` = bu istasyon için bilinmiyor / uygun değil. */
export interface StationKursunInfo {
  enabled: boolean;
  /** Aktif varsayılan gramajın adı (ör. "25 gr"); yoksa null. */
  defaultGramaj: string | null;
}

export interface StationListItem {
  station: Station;
  machines: Machine[];
  /** İstasyonun makinelerine bağlı AKTİF cihazlar (toplam). */
  deviceCount: number;
  propertyCount: number | null;
  kursun: StationKursunInfo | null;
}

/** Kurşun ayarı açılabilir mi — backend `STEP_FLOW_WHERE` aynası (kart akışı yürüten istasyon). */
export function canHaveKursun(s: Pick<Station, "kind" | "appliesQuality">): boolean {
  return s.kind === StationKind.PROCESS_QC || s.appliesQuality === true;
}

export function kursunInfoFromDto(d: KursunStationDto): StationKursunInfo {
  const def = d.values.find((v) => v.isActive && v.isDefault);
  return { enabled: d.enabled, defaultGramaj: def ? def.name : null };
}

export function buildStationListItems(
  stations: readonly Station[],
  machinesByStation: ReadonlyMap<string, Machine[]>,
  peripheralsByMachine: ReadonlyMap<string, PeripheralDevice[]>,
  capByStation: ReadonlyMap<string, StationCapabilitySummary>,
  kursunByStation: ReadonlyMap<string, StationKursunInfo>,
): StationListItem[] {
  return stations.map((s) => {
    const machines = machinesByStation.get(s.id) ?? [];
    return {
      station: s,
      machines,
      deviceCount: machines.reduce((n, m) => n + (peripheralsByMachine.get(m.id)?.length ?? 0), 0),
      propertyCount: capByStation.get(s.id)?.propertyCount ?? null,
      kursun: kursunByStation.get(s.id) ?? null,
    };
  });
}
