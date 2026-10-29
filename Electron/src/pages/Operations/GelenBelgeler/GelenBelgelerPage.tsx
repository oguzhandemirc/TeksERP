// GELEN BELGELER (Gülkesim OCR D5) — müşteri irsaliyesi taslakları: liste + süzgeç + yeni elle taslak.
// Fotoğraf tabletten gelir (okuma işi DRAFT yazar); panel gözden geçirir ve onaylar (SoD: `gelen-belge:approve`).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { useAttemptToken } from "@/lib/attemptToken";
import { createManualNote } from "./service";
import { ReaderStatusBadge } from "./ReaderStatusBadge";
import { NoteListFilters } from "./NoteListFilters";
import { NoteListTable } from "./NoteListTable";
import { EMPTY_FILTER, useNoteList, type NoteListFilter } from "./useNoteList";

export const INCOMING_DOCUMENTS_PATH = "/operations/gelen-belgeler";

export function IncomingDocumentsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NoteListFilter>(EMPTY_FILTER);
  const q = useDebouncedValue(filter.q, 250);
  const { q: list, items, summary } = useNoteList({ ...filter, q });
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: Boolean(list.hasNextPage),
    isLoading: list.isFetchingNextPage,
    onLoadMore: () => void list.fetchNextPage(),
  });
  const attempt = useAttemptToken();
  const create = useMutation({
    mutationFn: () => createManualNote(attempt.token()),
    onSuccess: (note) => {
      attempt.onSuccess();
      void navigate(`${INCOMING_DOCUMENTS_PATH}/${note.id}`);
    },
    onError: (e) => attempt.onFailure(e),
  });

  return (
    <PageShell>
      <PageHeader
        title="Gelen Belgeler"
        titleExtra={<ReaderStatusBadge />}
        description="Müşteri irsaliyesi — fotoğraftan okunan ya da elle girilen taslak; onayda emanet topu doğar."
        actions={
          <PermissionGate permission="gelen-belge:write">
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              <Plus className="mr-1 h-4 w-4" />
              Elle taslak
            </Button>
          </PermissionGate>
        }
      />
      <NoteListFilters filter={filter} onChange={setFilter} summary={summary} />
      <PageBody ref={rootRef} className="min-h-0 p-4 sm:p-6">
        {list.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : list.isError && items.length === 0 ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Liste yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">Bu bir “belge yok” cevabı değildir; yeni taslak açmadan önce tekrar deneyin.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Bu süzgece uyan gelen belge yok. Tabletten irsaliye fotoğrafı çekin ya da “Elle taslak” açın.
          </div>
        ) : (
          <>
            <NoteListTable rows={items} onOpen={(id) => navigate(`${INCOMING_DOCUMENTS_PATH}/${id}`)} />
            <AutoLoadMore ref={sentinelRef} hasMore={Boolean(list.hasNextPage)} isFetchingMore={list.isFetchingNextPage} count={items.length} />
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
