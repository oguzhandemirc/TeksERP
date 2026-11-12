// =============================================================================
// Üretim İstasyonları — LİSTE görünümü (2026-11-08 yeniden tasarım)
// =============================================================================
// Satır = İSTASYON (makineler sağ paneldedir). Satıra tıklama `StationDetailPanel`'i açar; seçili satır
// vurgulu. "Tip" sütunu yalnız listede dış/fason istasyon varsa çizilir (hep "Dahili" yer kaplamasın).
// Kart görünümü olduğu gibi durur.
// =============================================================================
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StationType } from "@/types/enums";
import type { Station } from "./types";
import type { StationListItem } from "./stationListItems";
import { StationListRow } from "./StationListRow";

interface Props {
  items: StationListItem[];
  selectedId: string | null;
  onSelect: (s: Station) => void;
}

export function stationListHeaders(showType: boolean): string[] {
  return ["İstasyon", "Süreç türü", "Yetenekler", ...(showType ? ["Tip"] : []), "Makine", "Durum", ""];
}

export function StationListView({ items, selectedId, onSelect }: Props) {
  const showType = items.some((i) => i.station.type === StationType.EXTERNAL);
  return (
    <Table data-testid="station-list-view" containerClassName="overflow-visible">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {stationListHeaders(showType).map((h, i) => (
            <TableHead key={h || `bos-${i}`} className={h === "Makine" ? "text-right" : undefined}>
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((it) => (
          <StationListRow key={it.station.id} item={it} selected={it.station.id === selectedId} showType={showType} onSelect={onSelect} />
        ))}
      </TableBody>
    </Table>
  );
}
