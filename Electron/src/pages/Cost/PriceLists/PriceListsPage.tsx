// =============================================================================
// MALİYET & TEKLİF › FİYAT LİSTELERİ (MAL-5) — `price-list:read`. Genel ya da müşteriye özel, dövizli satış fiyatı
// listeleri; teklif kalemi fiyat önerisinde ÖNCE yayındaki listeye bakar. Süzme + cursor + özet SUNUCUDA.
// =============================================================================
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatCalendarDay } from "@/lib/factory-time";
import { CostQueryError } from "../shared/CostQueryState";
import { PriceListCreateDialog } from "./PriceListCreateDialog";
import { PriceListFilters } from "./PriceListFilters";
import { PriceListStatusBadge } from "./PriceListStatusBadge";
import { priceListService } from "./service";
import { EMPTY_PRICE_LIST_FILTER, priceListLabel, type PriceListFilter, type PriceListRow } from "./pl-types";
import { RefreshButton } from "@/components/RefreshButton";

const PAGE = 50;

export function PriceListsPage() {
  const nav = useNavigate();
  const [f, setF] = useState<PriceListFilter>(EMPTY_PRICE_LIST_FILTER);
  const [creating, setCreating] = useState(false);
  const query = { ...f, q: useDebouncedValue(f.q) };
  const q = useInfiniteQuery({
    queryKey: ["price-lists", "list", query],
    queryFn: ({ pageParam }) => priceListService.list(query, pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.data);
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_PRICE_LIST_FILTER);
  return (
    <PageShell>
      <PageHeader
        title="Fiyat Listeleri"
        description="Genel ya da müşteriye özel satış fiyatları. Teklif kalemine fiyat önerilirken önce yayındaki liste kullanılır. Yayınlanan liste değişmez — değişiklik revizyondur."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["price-lists", "list"]} />
            <PermissionGate permission="price-list:write">
              <Button onClick={() => setCreating(true)} data-testid="pl-new"><Plus className="mr-1 h-4 w-4" />Yeni liste</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar>
        <PriceListFilters value={f} onChange={setF} summary={q.data?.pages[0]?.ozet} />
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Fiyat listeleri" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="pl-empty">
              {filtered ? "Süzgece uyan liste yok." : "Henüz fiyat listesi yok — \"Yeni liste\" ile başlayın; satırları standart maliyetten doldurabilirsiniz."}
            </div>
          </ListMessage>
        ) : (
          <PriceListTable rows={rows} onOpen={(id) => nav(`/cost/price-lists/${id}`)} />
        )}
      </ListBody>
      {/* [EL-09] sapması devralındı: elle "Daha fazla yükle" (davranış korunarak alt şeride taşındı). */}
      <ListFooter loaded={rows.length}>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        )}
      </ListFooter>
      {creating && <PriceListCreateDialog open onOpenChange={setCreating} onCreated={(id) => nav(`/cost/price-lists/${id}`)} />}
    </PageShell>
  );
}

function PriceListTable({ rows, onOpen }: { rows: PriceListRow[]; onOpen: (id: string) => void }) {
  return (
    <Table containerClassName="overflow-visible">
      <TableHeader>
        <TableRow>
          <TableHead>Liste no</TableHead>
          <TableHead>Ad</TableHead>
          <TableHead>Kapsam</TableHead>
          <TableHead>Döviz</TableHead>
          <TableHead>Geçerlilik</TableHead>
          <TableHead className="text-right">Satır</TableHead>
          <TableHead>Durum</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)} data-testid="pl-row">
            <TableCell className="whitespace-nowrap font-mono text-xs">{priceListLabel(r)}</TableCell>
            <TableCell className="min-w-40">{r.name}</TableCell>
            <TableCell>{r.customer ? r.customer.name : <span className="text-muted-foreground">Genel</span>}</TableCell>
            <TableCell>{r.currency}</TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              {r.validFromDate || r.validUntilDate ? `${r.validFromDate ? formatCalendarDay(r.validFromDate) : "…"} – ${r.validUntilDate ? formatCalendarDay(r.validUntilDate) : "…"}` : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{r._count.lines}</TableCell>
            <TableCell><PriceListStatusBadge status={r.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
