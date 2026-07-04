import { Search, X, Palette, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type MachinePresence = "all" | "has" | "none" | "active";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  stationId: string;
  onStationId: (v: string) => void;
  machinePresence: MachinePresence;
  onMachinePresence: (v: MachinePresence) => void;
  capOnly: boolean;
  onCapOnly: (v: boolean) => void;
  hasAnyFason: boolean;
  stationOptions: { id: string; name: string }[];
  visibleCount: number;
  totalCount: number;
  anyFilterActive: boolean;
  onClear: () => void;
  showInactive: boolean;
  onToggleInactive: () => void;
}

/** Üretim İstasyonları kart listesi için istemci-tarafı filtre çubuğu (PageHeader'ın altında). */
export function StationFilterBar({
  search,
  onSearch,
  stationId,
  onStationId,
  machinePresence,
  onMachinePresence,
  capOnly,
  onCapOnly,
  hasAnyFason,
  stationOptions,
  visibleCount,
  totalCount,
  anyFilterActive,
  onClear,
  showInactive,
  onToggleInactive,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 text-xs">
      {/* 1) Ara */}
      <div className="relative min-w-[180px] max-w-xs flex-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="İstasyon / makine ara..."
          className="h-8 pl-8 text-sm"
        />
      </div>

      {/* 2) İstasyon */}
      <Select value={stationId} onValueChange={onStationId}>
        <SelectTrigger
          className={cn("h-8 w-auto min-w-[160px] gap-1 text-xs", stationId !== "__all__" && "border-primary/50")}
        >
          <SelectValue placeholder="İstasyon" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Tümü (İstasyon)</SelectItem>
          {stationOptions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 4) Makine varlığı */}
      <Select value={machinePresence} onValueChange={(v) => onMachinePresence(v as MachinePresence)}>
        <SelectTrigger
          className={cn("h-8 w-auto min-w-[150px] gap-1 text-xs", machinePresence !== "all" && "border-primary/50")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Makine: Tümü</SelectItem>
          <SelectItem value="has">Makinesi var</SelectItem>
          <SelectItem value="none">Makinesi yok</SelectItem>
          <SelectItem value="active">Aktif makinesi var</SelectItem>
        </SelectContent>
      </Select>

      {/* 5) Yetenek (yalnız fason istasyon varsa) */}
      {hasAnyFason && (
        <Button
          type="button"
          size="sm"
          variant={capOnly ? "default" : "outline"}
          className="h-8 gap-1 text-xs"
          onClick={() => onCapOnly(!capOnly)}
        >
          <Palette className="h-3.5 w-3.5" /> Yeteneği tanımlı fason
        </Button>
      )}

      {/* Sağ küme */}
      <div className="ml-auto flex items-center gap-2">
        {anyFilterActive && (
          <>
            <Badge variant="muted">
              {visibleCount} / {totalCount} istasyon
            </Badge>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onClear}>
              <X className="h-3.5 w-3.5" /> Temizle
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant={showInactive ? "default" : "outline"}
          className={
            showInactive
              ? "bg-amber-500 text-white hover:bg-amber-600"
              : "border-amber-400 text-amber-600 hover:bg-amber-50"
          }
          onClick={onToggleInactive}
        >
          {showInactive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {showInactive ? "Pasifleri gizle" : "Pasifleri göster"}
        </Button>
      </div>
    </div>
  );
}
