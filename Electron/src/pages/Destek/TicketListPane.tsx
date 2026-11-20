import { useEffect } from "react";
import { Inbox } from "lucide-react";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/utils";
import { useDestekStore } from "./destek-store";
import { readDestekError } from "./errors";
import { STATUS_CLASS, STATUS_LABEL } from "./labels";
import { formatWhen } from "./MessageBubble";
import { useTicketList } from "./useTicketQueries";
import type { TicketListItem, TicketScope, TicketStatus } from "./types";

interface Props {
  scope: TicketScope;
  statuses: TicketStatus[] | undefined;
  filterKey: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function Row({ t, active, showRequester, onSelect }: { t: TicketListItem; active: boolean; showRequester: boolean; onSelect: () => void }) {
  const unread = t.unreadReplies > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent/50",
          active && "bg-primary/10 hover:bg-primary/10",
        )}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Okunmamış yanıt" />}
          <span className="font-mono">{t.number}</span>
          <span className="ml-auto">{formatWhen(t.lastActivityAt)}</span>
        </div>
        <span className={cn("truncate text-sm", unread && "font-semibold")}>{t.subject}</span>
        <div className="flex items-center gap-2">
          <Badge className={cn("text-[10px]", STATUS_CLASS[t.status])}>{STATUS_LABEL[t.status]}</Badge>
          {showRequester && t.requester && <span className="truncate text-[11px] text-muted-foreground">{t.requester.name}</span>}
        </div>
      </button>
    </li>
  );
}

/** Talep listesi — süzme ve sıra SUNUCUDA; dibe gelince sonraki sayfa otomatik yüklenir. */
export function TicketListPane({ scope, statuses, filterKey, selectedId, onSelect }: Props) {
  const q = useTicketList(scope, statuses, filterKey);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // Firma kapsamına yetki yoksa (403) sekme bu oturum boyunca gizlenir; sayfa "Benim"e döner.
  const denyTenant = useDestekStore((s) => s.denyTenant);
  useEffect(() => {
    if (scope === "tenant" && q.error && readDestekError(q.error).status === 403) denyTenant();
  }, [scope, q.error, denyTenant]);
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: Boolean(q.hasNextPage),
    isLoading: q.isFetchingNextPage,
    onLoadMore: () => void q.fetchNextPage(),
  });

  return (
    <div ref={rootRef} className="h-full min-h-0 overflow-auto">
      {q.isError && <div className="p-3"><Callout tone="danger">{readDestekError(q.error).message}</Callout></div>}
      {q.isPending && <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>}
      {!q.isPending && !q.isError && items.length === 0 && (
        <EmptyState icon={Inbox} title="Talep yok" description="Bu süzgece uyan talep bulunmuyor." />
      )}
      <ul aria-label="Talepler">
        {items.map((t) => (
          <Row key={t.id} t={t} active={t.id === selectedId} showRequester={scope === "tenant"} onSelect={() => onSelect(t.id)} />
        ))}
      </ul>
      <AutoLoadMore ref={sentinelRef} hasMore={Boolean(q.hasNextPage)} isFetchingMore={q.isFetchingNextPage} count={items.length} />
    </div>
  );
}
