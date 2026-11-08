// Emanet çıkış kalem seçicisi (levent / iplik lotu) — doğrudan modal, sunucu araması + cursor. Satır SÜZÜLMEZ: sahibi
// seçili müşteri olmayan kayıt görünür ama seçilemez, nedeni satırda yazar (sahip kapısının asıl sahibi sunucu önizlemesi).
import { useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";

export interface PickerPage<T> {
  rows: T[];
  nextCursor: string | null;
}

interface Props<T extends { id: string }> {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | null, search: string) => Promise<PickerPage<T>>;
  renderRow: (row: T) => ReactNode;
  /** Seçilemezse Türkçe neden; seçilebilirse null. */
  disabledReason: (row: T) => string | null;
  onPick: (row: T) => void;
  emptyText: string;
}

export function OwnedPickerDialog<T extends { id: string }>(p: Props<T>) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 300).trim();
  const listQ = useInfiniteQuery({
    queryKey: [...p.queryKey, q],
    queryFn: ({ pageParam }) => p.fetchPage(pageParam, q),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: p.open,
    staleTime: 0,
  });
  const rows = (listQ.data?.pages ?? []).flatMap((pg) => pg.rows);
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
          ) : listQ.isError ? (
            <div className="p-4 text-sm">
              <p className="text-destructive">Liste yüklenemedi — bu “kayıt yok” demek değildir.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void listQ.refetch()}>
                Tekrar dene
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{p.emptyText}</p>
          ) : (
            <PickerRows rows={rows} renderRow={p.renderRow} disabledReason={p.disabledReason} onPick={p.onPick} />
          )}
        </div>
        {listQ.hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={listQ.isFetchingNextPage}
            onClick={() => void listQ.fetchNextPage()}
          >
            {listQ.isFetchingNextPage ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Daha fazla
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

type RowsProps<T extends { id: string }> = Pick<Props<T>, "renderRow" | "disabledReason" | "onPick"> & { rows: T[] };

function PickerRows<T extends { id: string }>({ rows, renderRow, disabledReason, onPick }: RowsProps<T>) {
  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const reason = disabledReason(row);
        return (
          <li key={row.id}>
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
