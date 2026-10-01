import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import type { UpdateStatus } from "@/types/server-update";
import { when } from "../License/LicenseParts";
import { SERVER_UPDATE_KEY, useServerUpdateStatus } from "./hooks";
import { LastResultCard, PolicyCard, UpdaterCard, VersionCard } from "./UpdateCards";
import { UpdateApprovalCard } from "./UpdateApprovalCard";
import { UpdateHistoryCard } from "./UpdateHistoryCard";

/** Dikkat isteyen durumlar — ekranın en üstünde, sade. */
function Notices({ s }: { s: UpdateStatus }) {
  const g = s.guncelleyici.durum;
  return (
    <>
      {g === "YOK" && (
        <Callout tone="muted" title="Bu sunucuda güncelleyici kurulu değil">
          Sunucu güncellemesi kurulum betiğiyle yapılır; bu ekran yalnız kurulu sürümü gösterir.
        </Callout>
      )}
      {g === "OLCULEMEDI" && (
        <Callout tone="warning" title="Güncelleyici yanıt vermiyor">
          {s.canlilik?.sonCanlilik ? `Son sinyal ${when(s.canlilik.sonCanlilik)}. ` : ""}
          Sunucuda “TeksERP-Guncelleyici” hizmetinin çalıştığını denetleyin.
        </Callout>
      )}
      {g === "DURDU" && (
        <Callout tone="danger" title="Son güncelleme geri alınamadı — müdahale gerekiyor">
          Güncelleyici yeni bir onay gelene dek hiçbir işlem başlatmaz. Destekle görüşmeden yeniden denemeyin.
        </Callout>
      )}
      {s.donuk && (
        <Callout tone="warning" title="Güncellemeler durduruldu">
          Lisans yaptırımı nedeniyle sunucu güncellemesi yapılamaz; satıcıyla görüşün.
        </Callout>
      )}
    </>
  );
}

/**
 * SUNUCU GÜNCELLEMELERİ (Dağıtım v2) — kurulu/yeni sürüm, kiradaki politika, güncelleyicinin canlılığı,
 * onay ("Şimdi kur" · "Bu gece kur"), son sonuç ve geçmiş. Okuma `license:view`, onay `license:manage`.
 * Karar güncelleyicinindir; panel yalnız gösterir ve onayı backend'e yazdırır.
 */
export function ServerUpdatesPage() {
  const { hasPermission } = useRoleAccess();
  const canManage = hasPermission("license:manage");
  const q = useServerUpdateStatus();
  const s = q.data;
  return (
    <PageShell>
      <PageHeader title="Sunucu Güncellemeleri" actions={<RefreshButton queryKey={[...SERVER_UPDATE_KEY]} />} />
      <PageBody className="space-y-4 p-6">
        {q.isLoading && <Skeleton className="h-40 w-full" />}
        {q.isError && (
          <Callout tone="warning" title="Güncelleme durumu okunamadı">
            {apiErrorText(q.error, "Sunucu güncelleme durumunu döndürmedi.")}
          </Callout>
        )}
        {s && <Notices s={s} />}
        {s && (
          <div className="grid gap-4 xl:grid-cols-2">
            <VersionCard s={s} />
            <PolicyCard s={s} />
            <UpdaterCard s={s} />
            {canManage ? <UpdateApprovalCard s={s} /> : <LastResultCard s={s} />}
            {canManage && <LastResultCard s={s} />}
            <div className={canManage ? "" : "xl:col-span-2"}>
              <UpdateHistoryCard items={s.gecmis} />
            </div>
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
