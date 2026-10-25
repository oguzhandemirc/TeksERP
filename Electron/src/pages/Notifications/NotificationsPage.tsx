// =============================================================================
// BİLDİRİMLER — kişisel gelen kutusunun GEÇMİŞ GÜNLÜĞÜ (plan §6.2)
// =============================================================================
// Liste, cursor ve özet şeridi sunucuda TEK where'den (`/api/bildirim`); süzgeç sunucuya gider
// (`sekme`, `filter[tur]`). Bayrak kapalı → "kapalı — Genel Ayarlar'dan açılır" (sessizce kaybolmaz);
// eski backend (`/ozet` 404) → "bu sunucu sürümü desteklemiyor". Zil ile aynı akışı paylaşır.
// =============================================================================
import { CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useTabsStore } from "@/store/tabs";
import type { NotificationItem } from "@/lib/bildirim/types";
import { NotificationFilters } from "./NotificationFilters";
import { NotificationTable } from "./NotificationTable";
import { INBOX_SETTINGS_PATH, EmptyList, UnsupportedState, ClosedState, LoadErrorState, SummaryStrip, LoadingState } from "./page-parts";
import { useNotificationsPage } from "./useNotificationsPage";

type PageState = ReturnType<typeof useNotificationsPage>;

function PageContent({ s, onAc }: { s: PageState; onAc: (b: NotificationItem) => void }) {
  const { liste } = s;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <NotificationFilters
        sekme={s.sekme}
        onSekme={s.setSekme}
        gruplar={s.katalogGruplari}
        seciliGruplar={s.gruplar}
        onGrupDegis={s.grupDegis}
      />
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <SummaryStrip
          toplam={s.toplam}
          okunmamis={s.zil.okunmamis}
          seciliSayi={s.secili.size}
          topluAcik={s.topluAcik}
          onToplu={() => void s.topluOkundu()}
        />
        {liste.isLoading ? (
          <LoadingState />
        ) : liste.isError ? (
          <LoadErrorState />
        ) : s.items.length === 0 ? (
          <EmptyList sekme={s.sekme} />
        ) : (
          <NotificationTable items={s.items} secili={s.secili} setSecili={s.setSecili} onAc={onAc} eylemler={s.eylemler} />
        )}
        {liste.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" disabled={liste.isFetchingNextPage} onClick={() => void liste.fetchNextPage()}>
              {liste.isFetchingNextPage ? "Yükleniyor…" : "Daha eski bildirimler"}
            </Button>
          </div>
        )}
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
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={zil.okunmamis === 0 || eylemler.tumunuOkundu.isPending}
              onClick={() => eylemler.tumunuOkundu.mutate()}
            >
              <CheckCheck className="h-4 w-4" /> Tümünü okundu say
            </Button>
          ) : undefined
        }
      />
      <PageBody className="p-4 md:p-6">
        {closed ? (
          <ClosedState yonetici={isAdmin} onAyar={() => navigateActive(INBOX_SETTINGS_PATH)} />
        ) : zil.hazir && !zil.destek ? (
          <UnsupportedState />
        ) : !zil.hazir ? (
          <LoadingState />
        ) : (
          <PageContent s={s} onAc={onAc} />
        )}
      </PageBody>
    </PageShell>
  );
}
