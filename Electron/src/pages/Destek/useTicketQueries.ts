import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toOutgoing, type DraftAttachment } from "./attachments";
import { useDestekStore } from "./destek-store";
import { readDestekError, type DestekError } from "./errors";
import { destekService } from "./service";
import type { TicketScope, TicketStatus, TicketView } from "./types";
import { pollUnreadOnce } from "./unread";

const PAGE_SIZE = 20;
/** "Taleplerim" açıkken liste ve ayrıntı bu aralıkla tazelenir (sözleşme §1 önerisi). */
const OPEN_REFRESH_MS = 30_000;

export const LIST_KEY = "destek-talepler";
export const DETAIL_KEY = "destek-talep";

export function useTicketList(scope: TicketScope, statuses: TicketStatus[] | undefined, filterKey: string) {
  return useInfiniteQuery({
    queryKey: [LIST_KEY, scope, filterKey],
    queryFn: ({ pageParam }) => destekService.list({ scope, status: statuses, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
    refetchInterval: OPEN_REFRESH_MS,
    retry: false,
  });
}

/** Rozeti hemen tazele (okundu / yanıt / kapatma sonrası) — hata sessiz. */
function refreshBadge(canTenant: boolean) {
  const st = useDestekStore.getState();
  void pollUnreadOnce({ fetchUnread: destekService.unread, canTenant, setUnread: st.setUnread, denyTenant: st.denyTenant });
}

/** Ayrıntı: açılışta bir kez `okundu` çağrılır (yeni ekip yanıtı gelince yeniden). */
export function useTicketDetail(id: string | null, canTenant: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [DETAIL_KEY, id],
    queryFn: () => destekService.detail(id ?? ""),
    enabled: Boolean(id),
    refetchInterval: OPEN_REFRESH_MS,
    retry: false,
  });
  const lastMarked = useRef<string | null>(null);
  const lastMessageId = query.data?.messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (!id || !lastMessageId) return;
    const mark = `${id}:${lastMessageId}`;
    if (lastMarked.current === mark) return;
    lastMarked.current = mark;
    destekService
      .markRead(id)
      .then(() => {
        void qc.invalidateQueries({ queryKey: [LIST_KEY] });
        refreshBadge(canTenant);
      })
      .catch(() => {
        /* okundu işareti best-effort: düşerse rozet bir sonraki yoklamada düzelir */
      });
  }, [id, lastMessageId, qc, canTenant]);
  return query;
}

function useTicketWrite(id: string, canTenant: boolean) {
  const qc = useQueryClient();
  return (ticket: TicketView) => {
    qc.setQueryData([DETAIL_KEY, id], ticket);
    void qc.invalidateQueries({ queryKey: [LIST_KEY] });
    refreshBadge(canTenant);
  };
}

export function useReply(id: string, canTenant: boolean) {
  const apply = useTicketWrite(id, canTenant);
  const [error, setError] = useState<DestekError | null>(null);
  const m = useMutation({
    mutationFn: (args: { message: string; files: DraftAttachment[] }) =>
      destekService.reply(id, {
        message: args.message.trim(),
        ...(args.files.length > 0 ? { files: toOutgoing(args.files) } : {}),
      }),
    onSuccess: (t) => {
      setError(null);
      apply(t);
    },
    // Hata yanıt kutusunun altında gösterilir (istek `suppressErrorToast` taşır).
    onError: (e) => setError(readDestekError(e)),
  });
  return { send: m.mutateAsync, isPending: m.isPending, error, clearError: () => setError(null) };
}

export function useCloseTicket(id: string, canTenant: boolean) {
  const apply = useTicketWrite(id, canTenant);
  const [error, setError] = useState<DestekError | null>(null);
  const m = useMutation({
    mutationFn: () => destekService.close(id),
    onSuccess: (t) => {
      setError(null);
      apply(t);
    },
    // Hata ayrıntı panelinde gösterilir (istek `suppressErrorToast` taşır).
    onError: (e) => setError(readDestekError(e)),
  });
  return { close: m.mutateAsync, isPending: m.isPending, error };
}
