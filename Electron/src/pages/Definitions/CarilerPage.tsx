// =============================================================================
// CARİLER — BİRLEŞİK GÖRÜNÜM (2026-08-14 kullanıcı kararı; yeni görünüm 2026-11-12)
// =============================================================================
// Müşteri/tedarikçi kartları + BAĞSIZ eski fason profilleri TEK listede, rol rozetiyle (görünüm birleştirmesi,
// tablo birleştirmesi değil). Ticaret rejiminde cari kartının TEK giriş kapısı bu ekran.
// Kayıt kalıbı (components/record): satır tıkı sağda YAN PANEL (liste görünür kalır), oradan TAM KAYIT SAYFASI
// (`definitions/cariler/:id`). Arama + sayfalama + rol sayıları SUNUCUDA (`useCariList`, `useCariRoleCounts`).
// Düzenleme sahiplerinin diyaloglarıyla (`useCariEditing`) — payload eşlemesi kopyalanmaz.
// =============================================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Users2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { RecordSplit } from "@/components/record/RecordSidePanel";
import { RecordEmpty } from "@/components/record/RecordBits";
import { apiErrorText } from "@/lib/api-error";
import { isCariFilterDirty } from "./carilerPaging";
import { CarilerFilterRow, useCariFilters } from "./CarilerFilterRow";
import { cariRecordPath, rowKey } from "./cariler/cari-row";
import { useCariList } from "./cariler/useCariList";
import { useCariRoleCounts } from "./cariler/useCariRoleCounts";
import { useCariSelection } from "./cariler/useCariSelection";
import { useCariEditing } from "./cariler/CariEditDialogs";
import { CariRoleStrip } from "./cariler/CariRoleStrip";
import { CariListTable } from "./cariler/CariListTable";
import { CariSidePanel } from "./cariler/CariSidePanel";

export function CarilerPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { filters, ready: filtersReady } = useCariFilters();
  const list = useCariList(search, filters, filtersReady);
  const counts = useCariRoleCounts(list.debouncedSearch, filtersReady);
  const sel = useCariSelection(list.rows);
  const editing = useCariEditing();
  const { rows, pageInfo, page, setPage } = list;
  const paged = rows.length > 0 && (pageInfo.hasPrev || pageInfo.hasNext);

  const body = list.loading ? (
    <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
  ) : list.isError ? (
    <CariListError error={list.error} onRetry={list.retry} />
  ) : rows.length === 0 ? (
    <ListMessage>
      <RecordEmpty
        icon={Users2}
        text={list.debouncedSearch || isCariFilterDirty(filters) ? "Bu aramayla eşleşen cari yok. Aramayı ya da rol seçimini değiştirin." : "Henüz cari kartı yok. Sağ üstten yeni cari ekleyebilirsiniz."}
      />
    </ListMessage>
  ) : (
    <CariListTable
      rows={rows}
      selectedKey={sel.selected ? sel.selectedKey : null}
      compact={Boolean(sel.selected)}
      onSelect={(r) => sel.select(sel.selectedKey === rowKey(r) ? null : r)}
      onEdit={(r) => editing.openEdit(r)}
      onOpenFull={(r) => navigate(cariRecordPath(r.id))}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Cariler"
        description="Müşteri, tedarikçi ve fason kartları tek listede. Bir cariye tıklayın: bakiyesi, siparişleri ve son hareketleri sağda açılır."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["customers", "cariler"]} extraKeys={[["subcontractors", "cariler"]]} />
            <PermissionGate permission="customer:write">
              <Button size="sm" onClick={editing.openCreate} title="Fason firma da buradan: kartta Fason iş yapar kutusu">
                <Plus className="mr-1 h-4 w-4" /> Yeni cari
              </Button>
            </PermissionGate>
          </div>
        }
      />
      <CariRoleStrip filters={filters} counts={counts.data} loading={counts.isLoading} />
      <RecordSplit
        list={
          <>
            <CarilerFilterRow search={search} onSearchChange={setSearch} trailing={<span className="whitespace-nowrap px-1 text-xs text-muted-foreground">{pageInfo.total} kart</span>} />
            <ListBody>{body}</ListBody>
            <ListFooter loaded={rows.length} total={pageInfo.total} label={paged ? `Sayfa ${page} · ${rows.length} / ${pageInfo.total} kart` : undefined}>
              {paged && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!pageInfo.hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>Önceki</Button>
                  <Button variant="outline" size="sm" disabled={!pageInfo.hasNext} onClick={() => setPage((p) => p + 1)}>Sonraki</Button>
                </div>
              )}
            </ListFooter>
          </>
        }
        panel={
          sel.selected && (
            <CariSidePanel
              key={sel.selectedKey}
              row={sel.selected}
              onClose={() => sel.select(null)}
              onPrev={sel.prev}
              onNext={sel.next}
              onOpenFull={sel.selected.kind === "CUSTOMER" ? () => navigate(cariRecordPath(sel.selected!.id)) : null}
              onEdit={() => sel.selected && editing.openEdit(sel.selected)}
            />
          )
        }
      />
      {editing.dialogs}
    </PageShell>
  );
}

/** ⚠️ HATA "KAYIT YOK" DEĞİLDİR: "kart yok" gören kullanıcı var olan carinin MÜKERRER kartını açar. */
function CariListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <ListMessage>
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
        <p className="font-medium text-destructive">Cari kartları yüklenemedi.</p>
        <p className="mt-1 text-muted-foreground">{apiErrorText(error, "İstek sunucuya ulaşamadı ya da reddedildi.")}</p>
        <p className="mt-1 text-muted-foreground">
          Bu bir “kart yok” cevabı DEĞİLDİR. Kartlarınız yerinde duruyor; <b>yeni kart açmadan önce</b> tekrar deneyin — aynı firmanın ikinci kartı bakiyeyi ikiye böler.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Tekrar dene</Button>
      </div>
    </ListMessage>
  );
}
