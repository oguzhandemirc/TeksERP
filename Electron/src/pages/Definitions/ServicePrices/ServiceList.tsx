// Sol liste: hizmet kalemleri (tam liste — sayfalı değil, hizmet kalemi az) + kademe satırı sayısı.
// ↑/↓ ile gezinilir, seçim anında tablo açılır.
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Search, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { foldedIncludes } from "@/lib/search-fold";
import type { ServiceListRow } from "./service";

interface Props {
  rows: ServiceListRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ServiceList({ rows, isLoading, isError, onRetry, selectedId, onSelect }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => (rows ?? []).filter((r) => !q || foldedIncludes(`${r.code} ${r.name}`, q)),
    [rows, q],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = filtered.findIndex((r) => r.id === selectedId);
    const next = filtered[Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), filtered.length - 1)];
    if (next) onSelect(next.id);
  };

  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col border-r">
      <div className="relative border-b p-2">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8"
          placeholder="Hizmet ara…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="Hizmet ara"
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-1"
        role="listbox"
        aria-label="Hizmetler"
        tabIndex={0}
        onKeyDown={onKey}
      >
        {isLoading ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="m-1 h-10" />)
        ) : isError ? (
          <div className="space-y-2 p-3 text-sm">
            <p className="text-destructive">Hizmet listesi yüklenemedi.</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Tekrar dene
            </Button>
          </div>
        ) : (rows ?? []).length === 0 ? (
          <div className="space-y-2 p-3 text-sm text-muted-foreground">
            <Wrench className="h-5 w-5" />
            <p>Henüz hizmet tanımlı değil.</p>
            <Link className="text-primary underline" to="/definitions/services">
              Hizmetler ekranından ekleyin
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">Bu aramayla hizmet yok.</p>
        ) : (
          filtered.map((r) => (
            <ServiceListItem key={r.id} row={r} selected={r.id === selectedId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  );
}

function ServiceListItem({
  row,
  selected,
  onSelect,
}: {
  row: ServiceListRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(row.id)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60",
        selected && "bg-primary/10 font-medium",
        !row.isActive && "opacity-60",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{row.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {row.code}
          {!row.isActive ? " · pasif" : ""}
        </span>
      </span>
      <span
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
        title="Güncel ve ileri tarihli kademe fiyatı sayısı"
      >
        {row.tierRowCount > 0 ? `${row.tierRowCount} kademe` : "kademesiz"}
      </span>
    </button>
  );
}
