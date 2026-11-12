import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { HubSkeleton } from "@/components/hub/HubSkeleton";
import { ReportCenterPage } from "./_v2/ReportCenterPage";

export function ReportsHubPage() {
  const ctx = useOperationsVisibilityContext();
  // Bayraklar gelene dek Merkez çizilmez (bölümler bir an kaybolup BELİRMESİN) — iskelet.
  if (!ctx.flagsReady) {
    return (
      <PageShell>
        <PageHeader title="Raporlar" />
        <PageBody className="p-6"><HubSkeleton count={9} /></PageBody>
      </PageShell>
    );
  }
  // Rapor Merkezi tek yol (bayrak 2026-11-12 emekli); "Eski raporlar" bölümü son eski raporla kalktı.
  return <ReportCenterPage />;
}
