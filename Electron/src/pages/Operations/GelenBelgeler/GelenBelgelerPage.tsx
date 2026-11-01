// GELEN BELGELER (Gülkesim OCR D5) — müşteri irsaliyesi taslakları: liste + süzgeç + yeni elle taslak + toplu taslak silme.
// Düzen Kumaş Stoğu ile aynı: başlık → süzgeç şeridi → tam genişlik DataTable (kendi kaydırıcısı + altlığı).
// Sayfaya dosya bırakmak "Belge yükle"yi o dosyalarla açar (`usePageFileDrop`).
// Fotoğraf tabletten ya da panelden (Belge yükle) gelir (okuma işi DRAFT yazar); panel gözden geçirir ve onaylar (SoD: `gelen-belge:approve`).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { FileCog, PackageCheck, Plus, Upload } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useAttemptToken } from "@/lib/attemptToken";
import { createManualNote, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import { SENDER_TEMPLATES_PATH } from "./GonderenSablonlariPage";
import { CUSTOMER_DEFAULTS_PATH } from "./paths";
import { UploadDialog } from "./UploadDialog";
import { ReaderStatusBadge } from "./ReaderStatusBadge";
import { NoteListFilters } from "./NoteListFilters";
import { NoteListTable } from "./NoteListTable";
import { EMPTY_FILTER, toQuery, useNoteList, type NoteListFilter } from "./useNoteList";
import { useNoteTable } from "./useNoteTable";
import { usePageFileDrop } from "./usePageFileDrop";

export const INCOMING_DOCUMENTS_PATH = "/operations/gelen-belgeler";

/** Şablon yönetimi yüzeyleri (`gelen-belge:template`): gönderen şablonları + müşteri varsayılan ürünleri (E4b). */
function TemplateLinks() {
  return (
    <PermissionGate permission="gelen-belge:template">
      <Button variant="ghost" asChild>
        <Link to={SENDER_TEMPLATES_PATH}>
          <FileCog className="mr-1 h-4 w-4" />
          Gönderen şablonları
        </Link>
      </Button>
      <Button variant="ghost" asChild>
        <Link to={CUSTOMER_DEFAULTS_PATH}>
          <PackageCheck className="mr-1 h-4 w-4" />
          Müşteri varsayılanları
        </Link>
      </Button>
    </PermissionGate>
  );
}

export function IncomingDocumentsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NoteListFilter>(EMPTY_FILTER);
  const [pageSize, setPageSize] = useState(50);
  const q = useDebouncedValue(filter.q, 250);
  const { q: list, items, summary } = useNoteList({ ...filter, q }, pageSize);
  const canWrite = useRoleAccess().hasPermission("gelen-belge:write");
  const canDelete = canWrite;
  const table = useNoteTable(items, canDelete, JSON.stringify(toQuery({ ...filter, q })));
  const pagination = {
    loaded: items.length,
    // Sekmenin toplamı aynı where'den gelen özet şeridinden (liste ile sayaç ayrışmaz).
    total: summary ? (filter.status ? summary[filter.status] : summary.total) : undefined,
    hasMore: Boolean(list.hasNextPage),
    isFetchingMore: list.isFetchingNextPage,
    pageSize,
    loadMore: () => list.fetchNextPage(),
    setPageSize,
  };
  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | undefined>(undefined);
  const openUpload = (files?: File[]) => {
    setDroppedFiles(files);
    setUploadOpen(true);
  };
  // Modal açıkken sayfa bırakmayı dinlemez (modalın kendi bırakma alanı var; portal olayları buraya da kabarır).
  const drop = usePageFileDrop(canWrite && !uploadOpen, (files) => openUpload(files));
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
    <PageShell className="relative" data-testid="incoming-documents-page" {...drop.handlers}>
      {drop.over && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-lg font-medium" data-testid="page-drop-overlay">
          Bırakın — Belge yükle bu dosyalarla açılır
        </div>
      )}
      <PageHeader
        title="Gelen Belgeler"
        titleExtra={<ReaderStatusBadge />}
        description="Müşteri irsaliyesi — fotoğraftan okunan ya da elle girilen taslak; onayda emanet topu doğar."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Kök anahtar: liste + sekme sayaçları/özet (aynı yanıt) + okuma durumu birlikte tazelenir. Yer Kumaş Stoğu ile aynı. */}
            <RefreshButton queryKey={INCOMING_DOCUMENT_QUERY_KEY} />
            <TemplateLinks />
            <PermissionGate permission="gelen-belge:write">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openUpload()}>
                  <Upload className="mr-1 h-4 w-4" />
                  Belge yükle
                </Button>
                <Button variant="outline" onClick={() => create.mutate()} disabled={create.isPending}>
                  <Plus className="mr-1 h-4 w-4" />
                  Elle taslak
                </Button>
              </div>
            </PermissionGate>
          </div>
        }
      />
      <NoteListFilters filter={filter} onChange={setFilter} summary={summary} trailing={<DataTableTools table={table} hideExport />} />
      <NoteListTable
        table={table}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => void list.refetch()}
        pagination={pagination}
        pathOf={(id) => `${INCOMING_DOCUMENTS_PATH}/${id}`}
        onOpen={(id) => void navigate(`${INCOMING_DOCUMENTS_PATH}/${id}`)}
        canDelete={canDelete}
      />
      {uploadOpen && (
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} target={{ kind: "new" }} initialFiles={droppedFiles} onDone={(note) => void navigate(`${INCOMING_DOCUMENTS_PATH}/${note.id}`)} />
      )}
    </PageShell>
  );
}
