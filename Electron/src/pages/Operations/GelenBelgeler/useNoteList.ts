// Liste sorgusu: süzme SUNUCUDA (durum/sahip/gönderen/arama/tarih), cursor ile sonsuz kaydırma; özet şeridi aynı where'den.
import { useInfiniteQuery } from "@tanstack/react-query";
import { listDeliveryNotes, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { DeliveryNoteListQuery, NoteStatus } from "./types";

export interface NoteListFilter {
  status: NoteStatus | null;
  ownerCustomerId: string | null;
  senderCustomerId: string | null;
  q: string;
  /** createdAt aralığı (`YYYY-MM-DD`); boş = sınırsız. */
  from: string;
  to: string;
}

export const EMPTY_FILTER: NoteListFilter = { status: null, ownerCustomerId: null, senderCustomerId: null, q: "", from: "", to: "" };

export function toQuery(f: NoteListFilter): DeliveryNoteListQuery {
  return {
    status: f.status ?? undefined,
    ownerCustomerId: f.ownerCustomerId ?? undefined,
    senderCustomerId: f.senderCustomerId ?? undefined,
    q: f.q.trim() || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    limit: 50,
  };
}

export function useNoteList(filter: NoteListFilter) {
  const base = toQuery(filter);
  const q = useInfiniteQuery({
    queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "list", base],
    queryFn: ({ pageParam }) => listDeliveryNotes({ ...base, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = q.data?.pages[0]?.summary ?? null;
  return { q, items, summary };
}
