import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type DeviceStatusFilter = "all" | "pending" | "approved" | "inactive" | "proof-lost";
export type DeviceKindFilter = "all" | "TABLET" | "PHONE" | "DESKTOP";

interface Props {
  search: string;
  onSearch: (v: string) => void;
  status: DeviceStatusFilter;
  onStatus: (v: DeviceStatusFilter) => void;
  kind: DeviceKindFilter;
  onKind: (v: DeviceKindFilter) => void;
  pendingCount: number;
  onShowPending: () => void;
  /** Kanıtı doğrulanamayan cihaz sayısı (D5); 0 → süzgeç seçeneği ve kısayol gizli. */
  proofLostCount?: number;
  resultCount: number;
  totalCount: number;
  anyFilterActive: boolean;
  onClear: () => void;
}

/** Cihazlar listesi filtre çubuğu — arama · durum · tür + onay-bekleyen kısayolu. */
export function DeviceFilterBar({
  search,
  onSearch,
  status,
  onStatus,
  kind,
  onKind,
  pendingCount,
  onShowPending,
  proofLostCount = 0,
  resultCount,
  totalCount,
  anyFilterActive,
  onClear,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 text-xs">
      <div className="relative min-w-[180px] max-w-xs flex-1">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cihaz adı / kimlik ara..."
          className="h-8 pl-8 text-sm"
        />
      </div>

      <Select value={status} onValueChange={(v) => onStatus(v as DeviceStatusFilter)}>
        <SelectTrigger className={cn("h-8 w-auto min-w-[150px] gap-1 text-xs", status !== "all" && "border-primary/50")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Durum: Tümü</SelectItem>
          <SelectItem value="pending">Onay bekliyor</SelectItem>
          <SelectItem value="approved">Onaylı</SelectItem>
          <SelectItem value="inactive">Pasif</SelectItem>
          {(proofLostCount > 0 || status === "proof-lost") && <SelectItem value="proof-lost">Anahtar kaybı</SelectItem>}
        </SelectContent>
      </Select>

      <Select value={kind} onValueChange={(v) => onKind(v as DeviceKindFilter)}>
        <SelectTrigger className={cn("h-8 w-auto min-w-[130px] gap-1 text-xs", kind !== "all" && "border-primary/50")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tür: Tümü</SelectItem>
          <SelectItem value="TABLET">Tablet</SelectItem>
          <SelectItem value="PHONE">Telefon</SelectItem>
          <SelectItem value="DESKTOP">PC</SelectItem>
        </SelectContent>
      </Select>

      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {status !== "proof-lost" && <ProofLostShortcut count={proofLostCount} onClick={() => onStatus("proof-lost")} />}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={onShowPending}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-2 py-1 font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {pendingCount} onay bekliyor
          </button>
        )}
        {anyFilterActive && (
          <>
            <Badge variant="muted">
              {resultCount} / {totalCount}
            </Badge>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
              Temizle
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** "N anahtar kaybı" kısayolu (D5) — süzgeci açar; sayı 0 iken görünmez. */
function ProofLostShortcut({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-50 px-2 py-1 font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
    >
      {count} anahtar kaybı
    </button>
  );
}
