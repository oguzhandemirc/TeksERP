// =============================================================================
// Üretim İstasyonları — LİSTE görünümü (ortak DataTable)
// =============================================================================
// Satır = İSTASYON (makineler sağ paneldedir). Satıra tıklama / Enter / ↑↓ `StationDetailPanel`'i açar; seçili
// satır vurgulu. Sütunlar `stationListColumns.tsx`te; tablo sayfada kurulur (Sütunlar menüsü filtre çubuğunda).
// =============================================================================
import type { Table } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import type { Station } from "./types";
import type { StationListItem } from "./stationListItems";

interface Props {
  table: Table<StationListItem>;
  selectedId: string | null;
  onSelect: (s: Station) => void;
}

export function StationListView({ table, selectedId, onSelect }: Props) {
  return (
    <DataTable
      table={table}
      activeRowId={selectedId}
      onRowClick={(it) => onSelect(it.station)}
      rowClassName={(it) => (it.station.isActive ? undefined : "text-muted-foreground")}
      rowTitle={(it) => `${it.station.name} — istasyon panelini aç`}
      emptyText="Filtreye uyan istasyon yok."
    />
  );
}
