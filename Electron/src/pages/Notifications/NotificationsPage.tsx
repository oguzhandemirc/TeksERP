// =============================================================================
// BİLDİRİMLER — kişisel gelen kutusunun GEÇMİŞ GÜNLÜĞÜ (plan §6.2)
// =============================================================================
// Liste, cursor ve özet şeridi sunucuda TEK where'den (`/api/bildirim`); süzgeç sunucuya gider
// (`sekme`, `filter[tur]`). Bayrak kapalı → "kapalı — <menü yolu>'den açılır" (sessizce kaybolmaz);
// eski backend (`/ozet` 404) → "bu sunucu sürümü desteklemiyor". Zil ile aynı akışı paylaşır.
// =============================================================================
import { CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { NOTIFICATION_QUERY_KEY } from "@/lib/bildirim/hooks";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import type { NotificationItem } from "@/lib/bildirim/types";
import { NotificationFilters } from "./NotificationFilters";
import { useNotificationTable } from "./notificationColumns";
import { INBOX_SETTINGS_PATH, EmptyList, UnsupportedState, ClosedState, LoadErrorState, SummaryStrip, LoadingState } from "./page-parts";
import { useNotificationsPage } from "./useNotificationsPage";

type PageState = ReturnType<typeof useNotificationsPage>;

/** Liste standardı: solda süzgeç kolonu; sağda sabit özet bandı → kenardan kenara tablo (sonsuz kaydırma) → alt şerit. */
function PageContent({ s, onAc }: { s: PageState; onAc: (b: NotificationItem) => void }) {
  const { liste } = s;
  const table = useNotificationTable({ items: s.items, secili: s.secili, setSecili: s.setSecili, onAc, eylemler: s.eylemler });
  const hasRows = !liste.isLoading && !liste.isError && s.items.length > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <NotificationFilters
        sekme={s.sekme}
        onSekme={s.setSekme}
        gruplar={s.katalogGruplari}
        seciliGruplar={s.gruplar}
        onGrupDegis={s.grupDegis}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ListToolbar className="flex-row flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <SummaryStrip
              toplam={s.toplam}
              okunmamis={s.zil.okunmamis}
              seciliSayi={s.secili.size}
              topluAcik={s.topluAcik}
              onToplu={() => void s.topluOkundu()}
            />
          </div>
          <DataTableTools table={table} hideExport compact />
        </ListToolbar>
        {hasRows ? (
          <DataTable
            table={table}
            selectionLabel={(b) => `Seç: ${b.baslik}`}
            showSelectionBar={false}
            rowClassName={(b) => (b.okunduAn ? undefined : "bg-primary/[0.03]")}
            loadMore={{ hasMore: Boolean(liste.hasNextPage), isFetchingMore: liste.isFetchingNextPage, onLoadMore: () => void liste.fetchNextPage() }}
          />
        ) : (
          <ListBody>
            {liste.isLoading ? (
              <LoadingState />
            ) : liste.isError ? (
              <ListMessage><LoadErrorState /></ListMessage>
            ) : (
              <ListMessage><EmptyList sekme={s.sekme} /></ListMessage>
            )}
          </ListBody>
        )}
        <ListFooter loaded={s.items.length} total={s.toplam} hasMore={Boolean(liste.hasNextPage)} isFetchingMore={liste.isFetchingNextPage} />
      </section>
    </div>
  );
}

export function NotificationsPage() {
  const s = useNotificationsPage();
  const { zil, eylemler } = s;
  const { isAdmin } = useRoleAccess();
  const navigateActive = useTabsStore((st) => st.navigateActive);
  const closed = !zil.bayrak || (zil.hazir && zil.destek && !zil.enabled);
  const onAc = (b: NotificationItem) => {
    if (!b.okunduAn) eylemler.okundu.mutate({ id: b.id, okundu: true });
    navigateActive(b.yol);
  };
  return (
    <PageShell>
      <PageHeader
        title="Bildirimler"
        description="Size gelen bildirimlerin geçmiş günlüğü — okundu, ertele, aç"
        actions={
          s.calisir ? (
            <div className="flex items-center gap-2">
              <RefreshButton queryKey={[...NOTIFICATION_QUERY_KEY]} successMessage="Bildirimler yenilendi" />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={zil.okunmamis === 0 || eylemler.tumunuOkundu.isPending}
                onClick={() => eylemler.tumunuOkundu.mutate()}
              >
                <CheckCheck className="h-4 w-4" /> Tümünü okundu say
              </Button>
            </div>
          ) : undefined
        }
      />
      {closed || !zil.hazir || !zil.destek ? (
        <PageBody className="p-4 md:p-6">
          {closed ? (
            <ClosedState yonetici={isAdmin} onAyar={() => navigateActive(INBOX_SETTINGS_PATH)} />
          ) : !zil.hazir ? (
            <LoadingState />
          ) : (
            <UnsupportedState />
          )}
        </PageBody>
      ) : (
        <PageContent s={s} onAc={onAc} />
      )}
    </PageShell>
  );
}
