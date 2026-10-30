// İşlem değeri (desen / gramaj) ARANABİLİR seçim modalı (D4-D2) — yüzlerce desenli katalog için.
// Süzme SUNUCUDA (`/islem-degerleri`); seçici doğrudan modal açar (combobox yok). Liste dibe yaklaşınca opak cursor'la sürer.
import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { INCOMING_DOCUMENT_QUERY_KEY, searchProcessValues } from "./service";

export interface PickedProcessValue {
  id: string;
  code: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  propertyName: string;
  selectedId?: string | null;
  onSelect: (value: PickedProcessValue) => void;
}

export const PROCESS_VALUE_PAGE_SIZE = 50;

export function ProcessValueSearchDialog({ open, onOpenChange, propertyId, propertyName, selectedId = null, onSelect }: Props) {
  const [term, setTerm] = useState("");
  const q = useDebouncedValue(term.trim(), 250);
  useEffect(() => {
    if (open) setTerm("");
  }, [open]);
  const query = useInfiniteQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "islem-degerleri", propertyId, q],
    queryFn: ({ pageParam }) => searchProcessValues({ propertyId, q: q || undefined, cursor: pageParam, limit: PROCESS_VALUE_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="process-value-search">
        <DialogHeader>
          <DialogTitle>{propertyName} seç</DialogTitle>
          <DialogDescription>Kod ya da adla arayın; arama sunucuda yapılır.</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Ara… (ör. D12)" value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`${propertyName} ara`} />
        <p className="text-xs text-muted-foreground" data-testid="process-value-total">
          {query.isLoading ? "Aranıyor…" : `${total} sonuç`}
        </p>
        <ul
          className="max-h-[50vh] divide-y overflow-y-auto rounded-md border"
          data-testid="process-value-list"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (query.hasNextPage && !query.isFetchingNextPage && el.scrollHeight - el.scrollTop - el.clientHeight < 80) void query.fetchNextPage();
          }}
        >
          {items.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className={cn("flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted", v.id === selectedId && "bg-primary/10 font-medium")}
                onClick={() => {
                  onSelect(v);
                  onOpenChange(false);
                }}
              >
                <span>{v.name}</span>
                <span className="text-xs text-muted-foreground">{v.code}</span>
              </button>
            </li>
          ))}
          {!query.isLoading && items.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Sonuç yok.</li>}
        </ul>
        {query.isFetchingNextPage && <p className="text-xs text-muted-foreground">Yükleniyor…</p>}
      </DialogContent>
    </Dialog>
  );
}
