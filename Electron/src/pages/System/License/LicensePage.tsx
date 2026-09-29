import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useLicenseScreenVisible } from "@/hooks/useLicenseStatus";
import { apiErrorText } from "@/lib/api-error";
import { useLicenseDetail } from "./hooks";
import { LicenseStatusCard } from "./LicenseStatusCard";
import { LicenseEntitlementCard } from "./LicenseEntitlementCard";
import { LicenseLeaseCard } from "./LicenseLeaseCard";
import { LicenseMachineCard } from "./LicenseMachineCard";
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
            <LicenseStatusCard d={d} />
            <LicenseEntitlementCard d={d} />
            <LicenseLeaseCard d={d} />
            <LicenseMachineCard d={d} />
            {canManage && <LicenseActivateCard d={d} />}
            {canManage && <LicenseOfflineCard d={d} />}
            {canManage && <LicenseTransferCard d={d} />}
            <LicenseProxyCard proxy={d.proxy} canManage={canManage} />
            {hasAnyPermission(HISTORY_ACCESS) && <LicenseHistoryCard />}
          </div>
        )}
      </PageBody>
    </PageShell>
  );
}
