import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";

export type MachinePresence = "all" | "has" | "none" | "active";

/** "Tümü" seçeneği `__all__`: sayfanın yerel durumu bu nöbetçiyi taşır (SelectChip'te `null`). */
const ALL = "__all__";

const PRESENCE_OPTIONS: { value: Exclude<MachinePresence, "all">; label: string }[] = [
  { value: "has", label: "Makinesi var" },
  { value: "none", label: "Makinesi yok" },
  { value: "active", label: "Aktif makinesi var" },
];

interface Props {
  search: string;
  onSearch: (v: string) => void;
  stationId: string;
  onStationId: (v: string) => void;
  machinePresence: MachinePresence;
  onMachinePresence: (v: MachinePresence) => void;
  stationOptions: { id: string; name: string }[];
  anyFilterActive: boolean;
  onClear: () => void;
  showInactive: boolean;
  onToggleInactive: () => void;
  /** Sağ uç araçları (Sütunlar, Dışa aktar). */
  tools?: ReactNode;
}

/**
 * Üretim İstasyonları için istemci-tarafı filtre çubuğu — tek satır:
 * `[Ara][İstasyon][Makine][Pasifleri göster] … [Temizle][araçlar]`. Sayı alt çubukta.
 */
export function StationFilterBar({
  search,
  onSearch,
  stationId,
  onStationId,
  machinePresence,
  onMachinePresence,
  stationOptions,
  anyFilterActive,
  onClear,
  showInactive,
  onToggleInactive,
  tools,
}: Props) {
  return (
    <ListToolbar className="flex-row flex-wrap items-center">
      <ListSearchBox value={search} onSearchChange={onSearch} searchHint="İstasyon / makine ara" />
      <SelectChip
        id="station"
        label="İstasyon"
        value={stationId === ALL ? null : stationId}
        options={stationOptions.map((s) => ({ value: s.id, label: s.name }))}
        onChange={(v) => onStationId(v ?? ALL)}
      />
      <SelectChip
        id="machine-presence"
        label="Makine"
        value={machinePresence === "all" ? null : machinePresence}
        options={PRESENCE_OPTIONS}
        onChange={(v) => onMachinePresence(v ?? "all")}
      />
      <ToolbarToggle checked={showInactive} onCheckedChange={onToggleInactive} label="Pasifleri göster" />
      <div className="ml-auto flex items-center gap-1.5">
        {anyFilterActive && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={onClear}>
            <X className="h-3.5 w-3.5" /> Temizle
          </Button>
        )}
        {tools}
      </div>
    </ListToolbar>
  );
}
