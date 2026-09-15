// =============================================================================
// Üretim İstasyonları — LİSTE görünümü (kullanıcı isteği #3, 2026-09-16)
// =============================================================================
// Satır = MAKİNE, dışa aktarım satırıyla AYNI şekil (`buildStationMachineRows`) — iki görünüm ve dosya
// tek kümeden. Makinesiz istasyon tek satır "—". Satır aksiyonları kart tablosuyla aynı bileşen
// (`MachineRowActions`); istasyon adına tıklama istasyon düzenleme. Kart görünümü olduğu gibi durur.
// Sütun sırası: İstasyon · Görev Türü · Tip · Departman · Yetenekler · Makine · Durum · Cihazlar · İşlemler.
// =============================================================================
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Station } from "./types";
import type { StationMachineRow } from "./stationMachineRows";
import type { MachineActionHandlers } from "./MachineRowActions";
import { StationListRow } from "./StationListRow";

interface Props {
  rows: StationMachineRow[];
  canWrite: boolean;
  onEditStation: (s: Station) => void;
  onAddMachine: (stationId: string) => void;
  machine: MachineActionHandlers;
}

export const STATION_LIST_HEADERS = ["İstasyon", "Görev Türü", "Tip", "Departman", "Yetenekler", "Makine", "Durum", "Cihazlar", "İşlemler"] as const;

export function StationListView({ rows, canWrite, onEditStation, onAddMachine, machine }: Props) {
  return (
    <div className="rounded-lg border bg-card" data-testid="station-list-view">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {STATION_LIST_HEADERS.map((h) => (
              <TableHead key={h} className={h === "İşlemler" ? "text-right" : undefined}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <StationListRow key={r.machine ? r.machine.id : `st-${r.station.id}`} r={r} canWrite={canWrite} onEditStation={onEditStation} onAddMachine={onAddMachine} machine={machine} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
