import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, RotateCcw, PowerOff, Upload, Merge } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { useDataTable } from "@/hooks/useDataTable";
import { MergeDialog } from "@/components/merge/MergeDialog";
import { useCrudMutations } from "@/hooks/useCrudMutations";
import { apiErrorText } from "@/lib/api-error";
import { PermissionGate } from "@/components/PermissionGate";
import { ImportDialog } from "@/components/import/ImportDialog";
import type { CrudService } from "@/services/crudService";

interface Props<T extends { id: string }> {
  title: string;
  description?: string;
  entityName: string;
  /**
   * Verilirse başlığa "İçe Aktar" düğmesi eklenir ve toplu yükleme sihirbazı
   * açılır. Değer, backend `import-registry`'deki varlık anahtarıdır
   * ("item", "customer", …). Düğme İKİ yetki ister: `data:import` (toplu
   * yükleme yeteneği) ve sayfanın kendi `writePermission`'ı.
   */
  importEntity?: string;
  queryKey: string;
  service: CrudService<T>;
  columns: ColumnDef<T>[];
  searchPlaceholder?: string;
  writePermission: string;
  /** Backend filter'larına eklenir (queryKey'e otomatik dahil edilir). */
  extraFilters?: Record<string, string>;
  /** Toolbar yanında render edilecek ek UI (filtre dropdown'ları vb.). */
  filterBar?: ReactNode;
  /** false → "Pasifleri göster" anahtarı çizilmez ve `isActive` ZORLANMAZ: durumu sayfa kendi
   *  süzgeciyle (`extraFilters`) yönetir; aynı soruya iki kontrol olmasın. Varsayılan true =
   *  bugünkü davranış (pasifler gizli). */
  inactiveToggle?: boolean;
  /** Sayfa başlığındaki aksiyonların SOLUNA (Yenile'den önce) eklenecek ek buton(lar) —
   * başka sayfaya götüren bağlantılar gibi tablo-dışı eylemler için. */
  /**
   * Bu liste birleştirilebilir bir ana veri ise varlık anahtarı. Verilirse
   * "Mükerrerler" düğmesi çizilir ve mükerrer temizlik ekranını O VARLIKLA
   * açar. ⚠️ Yerleşim gerekçesi: ekranın kendisi Sistem hub'ının altında ve
   * hub `admin:settings` istiyor — yani aracı asıl kullanacak kişi (satış,
   * planlama) oraya HİÇ ulaşamaz. Operatör mükerreri zaten LİSTEYE BAKARKEN
   * fark ediyor; giriş kapısı da orada olmalı.
   */
  mergeEntity?: "customer" | "item" | "color" | "subcontractor";
  headerExtra?: ReactNode;
  /** Kayıt yokken "Yeni" butonunu glow animasyonuyla vurgula. */
  glowWhenEmpty?: boolean;
  /** Üst PageHeader'ı gizle (bir sekmeye gömülürken çift başlığı önler) —
   * Yenile/Yeni butonları araç çubuğuna taşınır (actionsPortal verilirse oraya). */
  hideHeader?: boolean;
  /** hideHeader iken Yenile/Yeni butonlarının render edileceği üst kapsayıcı
   * (ör. saran sayfanın PageHeader aksiyon alanı) — createPortal ile taşınır. */
  actionsPortal?: HTMLElement | null;
  /** KALICI SİLME ayrımı (users kalıbı): verilirse pasife-al ikonu PowerOff olur ve
   * ayrıca Trash2 = kalıcı sil (DELETE /:id/permanent) eklenir. Backend'i deletedAt
   * damgalı modellerde kayıt gizlenir ama veri bütünlüğü için DB'de durur. */
  permanentDelete?: { description: (row: T) => string };
  /** Sayfanın KENDİ kaldırma akışı (ürün: "Kullanımdan kaldır" diyaloğu): verilirse düğme
   *  genel onay diyaloğunu açmaz, satırı buraya verir; `removeLabel` düğmenin adı. */
  onRemove?: (row: T) => void;
  removeLabel?: string;
  /** Pasif satırdaki ⟲ için sayfanın KENDİ akışı (ürün: aynı durum diyaloğu); `restoreLabel` düğmenin adı. */
  onRestore?: (row: T) => void;
  restoreLabel?: string;
  /** Çok-sekmeli DÜZENLEME formları için: mevcut kaydı güncelleyince dialog
   * kapanmaz, güncel kayıtla düzenlemeye devam edilir — böylece kullanıcı aynı
   * oturumda şube/alias/şablon sekmeleri arasında çalışmaya devam edebilir.
   * OLUŞTURMA her zaman kapanır (tek-adım kayıt → kapat). Varsayılan false. */
  keepFormOpenAfterSave?: boolean;
  renderForm: (params: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initial: T | null;
    onSubmit: (values: Partial<T>) => Promise<void>;
    isSubmitting: boolean;
  }) => ReactNode;
}

export function CrudPage<T extends { id: string }>({
  title,
  description,
  entityName,
  importEntity,
  queryKey,
  service,
  columns,
  searchPlaceholder,
  writePermission,
  extraFilters,
  filterBar,
  inactiveToggle = true,
  mergeEntity,
  headerExtra,
  glowWhenEmpty,
  hideHeader,
  renderForm,
  permanentDelete,
  onRemove,
  removeLabel,
  onRestore,
  restoreLabel,
  actionsPortal,
  keepFormOpenAfterSave,
}: Props<T>) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [hardRemoving, setHardRemoving] = useState<T | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const forceFilters = useMemo<Record<string, string>>(
    () => ({
      ...(inactiveToggle && !showInactive ? { isActive: "true" } : {}),
      ...extraFilters,
    }),
    [inactiveToggle, showInactive, extraFilters],
  );

  const { createMutation, updateMutation, removeMutation, restoreMutation, hardRemoveMutation } = useCrudMutations<T>({
    service,
    queryKey,
    entityName,
  });

  // Perf: kolonları memoize et. react-table kolon modelini (getAllColumns/leaf/
  // header groups) kolon dizisinin REFERANSINA göre memoize eder. Inline dizi her
  // render'da (arama tuşu, mutation pending) yeniden kuruluyor, tüm kolon
  // örneklerini yeniden yaratıyordu. Bu, tüm master-data sayfalarının ortak kabı.
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () => [
      ...columns,
      {
        id: "actions",
        header: "",
        size: 80,
        cell: ({ row }) => {
          const isActive = (row.original as { isActive?: boolean }).isActive !== false;
          return (
            <div className="flex justify-end gap-1">
              <PermissionGate permission={writePermission}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(row.original);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {isActive ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    title={removeLabel ?? (permanentDelete ? "Pasife Al (geri alınabilir)" : undefined)}
                    aria-label={removeLabel}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRemove) onRemove(row.original);
                      else setRemovingId(row.original.id);
                    }}
                  >
                    {permanentDelete || onRemove ? <PowerOff className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-primary"
                    title={restoreLabel ?? "Aktifleştir"}
                    aria-label={restoreLabel}
                    disabled={restoreMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRestore) onRestore(row.original);
                      else restoreMutation.mutate(row.original.id);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
                {permanentDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    title="Kalıcı Sil (GERİ ALINAMAZ)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHardRemoving(row.original);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </PermissionGate>
            </div>
          );
        },
      },
    ],
    // restoreMutation.isPending → aktifleştir butonunun `disabled`'ı; state
    // setter'ları ve restoreMutation.mutate referans olarak kararlı.
    [columns, writePermission, permanentDelete, onRemove, removeLabel, onRestore, restoreLabel, restoreMutation.isPending],
  );

  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<T>({
    queryKey,
    fetchFn: service.listCursor,
    forceFilters,
    columns: tableColumns,
  });

  const onSubmit = async (values: Partial<T>) => {
    if (editing) {
      const res = await updateMutation.mutateAsync({ id: editing.id, data: values });
      // keepFormOpenAfterSave: güncellemede dialog açık kalır, güncel kayıtla
      // düzenlemeye devam (çok-sekmeli formlarda sekmeler arası çalışma).
      if (keepFormOpenAfterSave) {
        setEditing(res.data);
        return;
      }
    } else {
      // Oluşturma her zaman kapanır — tek-adım kayıt (gerekli iç-içe veri aynı
      // istekte gönderilir; ayrı bir "önce kaydet, sonra alt-sekme" adımı yok).
      await createMutation.mutateAsync(values);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const navigate = useNavigate();
  const isEmpty = glowWhenEmpty && query.isSuccess && !search && !showInactive && pagination.total === 0;

  // BİRLEŞTİRME — listeden doğrudan (2026-08-22, kullanıcı kararı: "cari
  // listesinde iki satırı işaretleyip oradan birleştireyim"). Diyalog ORTAK
  // bileşendir; buraya ikinci bir onay kapısı yazmak, korumaların ayrışması
  // demekti. Seçim `useDataTable`in mevcut satır seçiminden okunur.
  const [mergeOpen, setMergeOpen] = useState(false);
  const selectedIds = table.getSelectedRowModel().rows.map((r) => r.original.id);

  const headerActions = (
    <>
      {headerExtra}
      {mergeEntity ? (
        // Çift kapı — birleştirme ucununkiyle BİREBİR aynı: `master-data:merge`
        // (yetenek) + varlığın write izni (bu veriye dokunabilme).
        <PermissionGate allOf={["master-data:merge", writePermission]}>
          {selectedIds.length >= 2 ? (
            // Seçim varsa fiil DEĞİŞİR: panele gitmek yerine seçilenleri
            // burada birleştirir. Sayı butonda yazılı — "hangi 2 kayıt?"
            // sorusu tıklamadan önce cevaplanmalı.
            <Button size="sm" onClick={() => setMergeOpen(true)}>
              <Merge className="h-4 w-4" /> Seçilenleri Birleştir ({selectedIds.length})
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/system/duplicates?entity=${mergeEntity}`)}
              title="Sistemin şüpheli bulduklarını incele — ya da listeden iki satır işaretleyip burada birleştir"
            >
              <Merge className="h-4 w-4" /> Mükerrerler
            </Button>
          )}
        </PermissionGate>
      ) : null}
      {importEntity ? (
        <PermissionGate allOf={["data:import", writePermission]}>
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> İçe Aktar
          </Button>
        </PermissionGate>
      ) : null}
      <RefreshButton queryKey={queryKey} />
      <PermissionGate permission={writePermission}>
        <Button
          size="sm"
          className={isEmpty ? "animate-pulse" : undefined}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Yeni
        </Button>
      </PermissionGate>
    </>
  );

  return (
    <PageShell>
      {!hideHeader && (
        <PageHeader title={title} description={description} actions={headerActions} />
      )}
      {hideHeader && actionsPortal && createPortal(headerActions, actionsPortal)}

      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder={searchPlaceholder}
        table={table}
        exportName={title}
        fetchAll={fetchAll}
        actions={
          <>
            {hideHeader && !actionsPortal && headerActions}
            {filterBar}
            {inactiveToggle && (
              <ToolbarToggle
                checked={showInactive}
                onCheckedChange={setShowInactive}
                label="Pasifleri göster"
                title="Pasife alınmış kayıtlar varsayılan olarak gizlidir."
              />
            )}
          </>
        }
      />

      {/* ⚠️ `isError` GEÇİLMEK ZORUNDA: bu tek satır 14 tanım ekranını birden
          kapatır. Geçilmezse liste hatası "Kayıt bulunamadı." diye basılır ve
          kullanıcı silinmiş sandığı kaydı YENİDEN tanımlar (mükerrer depo/cari).
          Ayrıntı: `DataTable` prop yorumu. */}
      <DataTable<T>
        table={table}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        errorText={apiErrorText(query.error, "İstek sunucuya ulaşamadı ya da reddedildi.")}
        pagination={pagination}
        emptyText="Kayıt bulunamadı."
      />

      {renderForm({
        open: formOpen,
        onOpenChange: (open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        },
        initial: editing,
        onSubmit,
        isSubmitting: createMutation.isPending || updateMutation.isPending,
      })}

      <ConfirmDialog
        open={Boolean(removingId)}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title={permanentDelete ? `${entityName} pasife al` : `${entityName} sil`}
        description={
          permanentDelete
            ? "Kayıt pasife alınır — listede 'Pasifleri göster' ile görünür ve istediğinde geri aktifleştirilebilir."
            : "Bu işlem kaydı pasife alır. Devam etmek istiyor musun?"
        }
        confirmLabel={permanentDelete ? "Pasife Al" : "Sil"}
        destructive
        isPending={removeMutation.isPending}
        onConfirm={async () => {
          if (!removingId) return;
          await removeMutation.mutateAsync(removingId);
          setRemovingId(null);
        }}
      />

      {permanentDelete && (
        <ConfirmDialog
          open={Boolean(hardRemoving)}
          onOpenChange={(open) => !open && setHardRemoving(null)}
          title={`${entityName} KALICI sil`}
          description={hardRemoving ? permanentDelete.description(hardRemoving) : ""}
          confirmLabel="Kalıcı Sil"
          destructive
          isPending={hardRemoveMutation.isPending}
          onConfirm={async () => {
            if (!hardRemoving) return;
            await hardRemoveMutation.mutateAsync(hardRemoving.id);
            setHardRemoving(null);
          }}
        />
      )}

      {importEntity ? (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          entity={importEntity}
          // Yükleme bitince liste tazelenir — kullanıcı yazılan kayıtları
          // görmek için sayfayı yenilemek zorunda kalmasın.
          onDone={() => void query.refetch()}
        />
      ) : null}

      {mergeEntity ? (
        <MergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          entity={mergeEntity}
          ids={selectedIds}
          onMerged={() => {
            // Birleşen kayıtlar listeden düşer; seçim de temizlenmeli yoksa
            // artık var olmayan id'ler bir sonraki birleştirmeye taşınır.
            table.resetRowSelection();
            void query.refetch();
          }}
        />
      ) : null}
    </PageShell>
  );
}
