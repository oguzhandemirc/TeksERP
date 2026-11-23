import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";

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
  /** Tablonun Sütunlar menüsü (sağ kümede). */
  tools?: ReactNode;
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
  tools,
}: Props) {
  return (
    <div data-list-surface="toolbar" className="flex flex-wrap items-center gap-1.5 border-b py-2 text-xs">
      <div className="relative w-full min-w-[180px] sm:w-56">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Ara…" title="Cihaz adı / kimlik ara" aria-label="Cihaz adı / kimlik ara"
          className="h-8 pl-8 text-sm"
        />
      </div>

      <SelectChip<DeviceStatusFilter>
        id="device-status"
        label="Durum"
        value={status}
        resetValue="all"
        options={[
          { value: "all", label: "Tümü" },
          { value: "pending", label: "Onay bekliyor" },
          { value: "approved", label: "Onaylı" },
          { value: "inactive", label: "Pasif" },
          ...(proofLostCount > 0 || status === "proof-lost" ? [{ value: "proof-lost" as const, label: "Anahtar kaybı" }] : []),
        ]}
        onChange={(v) => onStatus(v ?? "all")}
      />
      <SelectChip<DeviceKindFilter>
        id="device-kind"
        label="Tür"
        value={kind}
        resetValue="all"
        options={[
          { value: "all", label: "Tümü" },
          { value: "TABLET", label: "Tablet" },
          { value: "PHONE", label: "Telefon" },
          { value: "DESKTOP", label: "PC" },
        ]}
        onChange={(v) => onKind(v ?? "all")}
      />

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
        {tools}
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
