import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ParamChips } from "@/pages/Reports/_v2/ParamChips";
import { ReportBody } from "@/pages/Reports/_v2/ReportBody";
import { ReportFailureState, ReportLoadingState } from "@/pages/Reports/_v2/ReportStates";
import type { ParametreBeyani } from "@/pages/Reports/_v2/sunum";
import { failureOf, useReportV2 } from "@/pages/Reports/_v2/useReportV2";

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
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const { hasPermission } = useRoleAccess();
  const blocked = !financeEnabled ? "Kârlılık faturadan okunur: Ön Muhasebe modülü kapalıyken hesaplanamaz." :
    !hasPermission("report:finance") ? "Kârlılık için ön muhasebe raporu izni (report:finance) de gerekir." : null;
  return (
    <PageShell className="overflow-hidden">
      {blocked ? (
        <>
          <PageHeader title={ENTRY.baslik} parent={{ label: "Maliyet & Teklif", to: "/cost" }} />
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
  const data = query.data;
  const failure = query.isError ? failureOf(query.error) : null;
  const summary = data ? settingsSummaryOf(data.parametreler) : null;
  return (
    <>
      <PageHeader
        title={ENTRY.baslik}
        parent={{ label: "Maliyet & Teklif", to: "/cost" }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Yenile">
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
            </Button>
            <ReportExportBar buildSpec={() => (data ? buildExportSpec(data) : null)} disabled={!data} />
          </div>
        }
      />
      <div className="border-b bg-muted/20 px-4 py-2 text-sm">
        <span className="font-medium">{ENTRY.soru}</span>
        {summary && <p className="mt-1 text-xs text-muted-foreground" data-testid="profit-settings-summary">hesap: {summary}</p>}
      </div>
      <ParamChips entry={ENTRY} params={data?.parametreler ?? []} personNamed={false} />
      <PageBody className="p-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          {failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <ReportBody presentation={data} fetchedAt={query.dataUpdatedAt} />
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </>
  );
}
