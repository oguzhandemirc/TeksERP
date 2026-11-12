import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { ReportLoadingState } from "@/pages/Reports/_v2/ReportStates";
import type { ParametreBeyani } from "@/pages/Reports/_v2/sunum";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";

export const PROFITABILITY_REPORT_KEY = "maliyet/karlilik";
const ENTRY = REPORT_BY_KEY.get(PROFITABILITY_REPORT_KEY)!;

/** Sunucunun okuma anındaki ayar özeti ("hesap: …"); Excel/PDF parametre cümlesine aynı beyandan girer. */
export function settingsSummaryOf(params: readonly ParametreBeyani[]): string | null {
  const p = params.find((x) => x.ad === "hesap");
  return typeof p?.deger === "string" ? p.deger : null;
}

/**
 * Kârlılık (D4-G3) — sunucunun v2 zarfını çizer, HESAP YAPMAZ (`cost-no-client-math` bu dizini de tarar).
 * Uç ön muhasebe + `report:finance` da ister: ikisi yoksa sorgu ATILMAZ (koşulsuz 403 yerine açıklama).
 */
export function ProfitabilityReportPage() {
  const flags = useFeatureFlags().data?.data;
  const { hasPermission } = useRoleAccess();
  // Bayraklar yüklenirken "kapalı" denmez — engel yalnız bayrak kesin false iken çizilir.
  if (!flags) return <PageShell className="overflow-hidden"><PageBody className="p-4"><ReportLoadingState /></PageBody></PageShell>;
  const blocked = !flags.financeEnabled ? "Kârlılık faturadan okunur: Ön Muhasebe modülü kapalıyken hesaplanamaz." :
    !hasPermission("report:finance") ? "Kârlılık için ön muhasebe raporu izni (report:finance) de gerekir." : null;
  return (
    <PageShell className="overflow-hidden">
      {blocked ? (
        <>
          <PageHeader title={ENTRY.baslik} parent={{ label: "Maliyet", to: "/cost" }} />
          <PageBody className="p-4"><p className="mx-auto max-w-3xl rounded-md border bg-muted/30 p-4 text-sm">{blocked}</p></PageBody>
        </>
      ) : (
        <ProfitabilityReportBody />
      )}
    </PageShell>
  );
}

function ProfitabilityReportBody() {
  const query = useReportV2(ENTRY);
  const summary = query.data ? settingsSummaryOf(query.data.parametreler) : null;
  return (
    <ReportV2Frame
      entry={ENTRY}
      query={query}
      parent={{ label: "Maliyet", to: "/cost" }}
      personNamed={false}
      questionExtra={summary ? <p className="mt-0.5 text-xs text-muted-foreground" data-testid="profit-settings-summary">hesap: {summary}</p> : undefined}
    />
  );
}
