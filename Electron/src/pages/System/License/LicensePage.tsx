import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useLicenseScreenVisible } from "@/hooks/useLicenseStatus";
import { apiErrorText } from "@/lib/api-error";
import { acceptanceGate } from "@/lib/license/acceptance";
import { useLicenseAcceptance, useLicenseDetail } from "./hooks";
import { LicenseAcceptanceCard } from "./LicenseAcceptanceCard";
import { LicenseStatusCard } from "./LicenseStatusCard";
import { LicenseEntitlementCard } from "./LicenseEntitlementCard";
import { LicenseLeaseCard } from "./LicenseLeaseCard";
import { LicenseMachineCard } from "./LicenseMachineCard";
import { LicenseIntegrityCard } from "./LicenseIntegrityCard";
import { LicenseActivateCard } from "./LicenseActivateCard";
import { LicenseOfflineCard } from "./LicenseOfflineCard";
import { LicenseTransferCard } from "./LicenseTransferCard";
import { LicenseProxyCard } from "./LicenseProxyCard";
import { LicenseHistoryCard } from "./LicenseHistoryCard";

/** Eylem geçmişi Sistem Kayıtları ucundan okunur; o ucun kapısı. */
const HISTORY_ACCESS = ["admin:settings", "system:activity"];

/**
 * LİSANS EKRANI — yönetici/satıcı. Okuma `license:view`, eylemler `license:manage`.
 *
 * Gözlem kipinde lisans fabrikaya sıfır farktır ve ekran yalnız satıcı kapısı
 * açık oturuma çizilir (`useLicenseScreenVisible`, karo ve paletle AYNI yüklem).
 */
export function LicensePage() {
  const visible = useLicenseScreenVisible();
  const { hasPermission, hasAnyPermission } = useRoleAccess();
  const canManage = hasPermission("license:manage");
  const q = useLicenseDetail(visible);
  const d = q.data;
  const acceptance = useLicenseAcceptance(visible);
  const gate = acceptanceGate(acceptance);
  const acceptanceCard = d ? <LicenseAcceptanceCard q={acceptance} canManage={canManage} active={d.kurulum.etkin} /> : null;

  return (
    <PageShell>
      <PageHeader title="Lisans" actions={visible ? <RefreshButton queryKey={["license"]} /> : undefined} />
      <PageBody className="space-y-4 p-6">
        {!visible && (
          <Callout tone="muted" title="Lisans gözlem kipinde">
            Bu kurulumda lisans yalnız gözlemleniyor; hiçbir işlemi etkilemez. Ayrıntılar satıcı
            hesabına gösterilir.
          </Callout>
        )}
        {visible && q.isLoading && <Skeleton className="h-40 w-full" />}
        {visible && q.isError && (
          <Callout tone="warning" title="Lisans bilgisi okunamadı">
            {apiErrorText(q.error, "Sunucu lisans bilgisini döndürmedi.")}
          </Callout>
        )}
        {d && !d.hazir && (
          <Callout tone="warning" title="Lisans motoru hazır değil">
            Kurulum kimliği ya da lisans klasörü henüz hazır değil; birkaç saniye sonra yenileyin.
          </Callout>
        )}
        {d && (
          <div className="grid gap-4 xl:grid-cols-2">
            {/* Etkinleşmemiş kurulumda sözleşme kabulü İLK adımdır (Ek-7 §5): kod girişinden önce, tam genişlik. */}
            {!d.kurulum.etkin && <div className="xl:col-span-2">{acceptanceCard}</div>}
            <LicenseStatusCard d={d} />
            <LicenseEntitlementCard d={d} />
            <LicenseLeaseCard d={d} canManage={canManage} />
            <LicenseMachineCard d={d} />
            <LicenseIntegrityCard b={d.butunluk} />
            {canManage && <LicenseActivateCard d={d} gate={gate} />}
            {canManage && <LicenseOfflineCard d={d} gate={gate} />}
            {canManage && <LicenseTransferCard d={d} />}
            <LicenseProxyCard proxy={d.proxy} canManage={canManage} />
            {d.kurulum.etkin && acceptanceCard}
            {hasAnyPermission(HISTORY_ACCESS) && <LicenseHistoryCard />}
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
