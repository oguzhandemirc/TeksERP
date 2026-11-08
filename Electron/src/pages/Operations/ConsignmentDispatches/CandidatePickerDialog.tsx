// Emanet çıkış kalem seçicisi (levent / iplik lotu) — doğrudan modal, sunucu aday ucundan okur
// (`/candidates`: sahip süzgeci + seçilebilirlik sunucuda, oluşturla aynı yüklem). Engelli satır görünür, nedeni yazar.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { listConsignmentCandidates } from "./service";
import type { ConsignmentCandidates } from "./types";

interface Props<T> {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  ownerCustomerId: string;
  /** Aday yanıtından bu seçicinin satırları + tavan bayrağı. */
  pick: (d: ConsignmentCandidates) => { rows: T[]; truncated: boolean; moduleOn: boolean };
  rowKey: (row: T) => string;
  renderRow: (row: T) => ReactNode;
  /** Seçilemezse Türkçe neden; seçilebilirse null. */
  disabledReason: (row: T) => string | null;
  onPick: (row: T) => void;
  emptyText: string;
}

export const CANDIDATES_QUERY_KEY = "consignment-candidates";

export function CandidatePickerDialog<T>(p: Props<T>) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 300).trim();
  const listQ = useQuery({
    queryKey: [CANDIDATES_QUERY_KEY, p.ownerCustomerId, q],
    queryFn: () => listConsignmentCandidates(p.ownerCustomerId, q),
    enabled: p.open,
    staleTime: 0,
  });
  const view = listQ.data ? p.pick(listQ.data) : null;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="flex h-[37.5rem] max-h-[85vh] max-w-lg flex-col" data-dirty-ignore="">
        <DialogHeader className="shrink-0">
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{p.description}</DialogDescription>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Ara (numara / ad)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {listQ.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : listQ.isError || !view ? (
            <div className="p-4 text-sm">
              <p className="text-destructive">Liste yüklenemedi — bu “kayıt yok” demek değildir.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void listQ.refetch()}>
                Tekrar dene
              </Button>
            </div>
          ) : !view.moduleOn ? (
            <p className="p-4 text-sm text-muted-foreground">Bu kalem türünün modülü kapalı.</p>
          ) : view.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{p.emptyText}</p>
          ) : (
            <PickerRows rows={view.rows} rowKey={p.rowKey} renderRow={p.renderRow} disabledReason={p.disabledReason} onPick={p.onPick} />
          )}
        </div>
        {view?.truncated && (
          <p className="shrink-0 text-xs text-amber-700 dark:text-amber-400" data-testid="candidates-truncated">
            İlk {view.rows.length} kayıt gösteriliyor — aradığınız yoksa aramayı daraltın.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RowsProps<T> = Pick<Props<T>, "rowKey" | "renderRow" | "disabledReason" | "onPick"> & { rows: T[] };

function PickerRows<T>({ rows, rowKey, renderRow, disabledReason, onPick }: RowsProps<T>) {
  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const reason = disabledReason(row);
        return (
          <li key={rowKey(row)}>
            <button
              type="button"
              disabled={reason !== null}
              onClick={() => onPick(row)}
              className={cn("flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm", reason ? "cursor-not-allowed opacity-60" : "hover:bg-muted/50")}
            >
              {renderRow(row)}
              {reason && <span className="text-xs text-amber-700 dark:text-amber-400">{reason}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
