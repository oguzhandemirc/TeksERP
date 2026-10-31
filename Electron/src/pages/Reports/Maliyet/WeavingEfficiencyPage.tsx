import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ParamChips } from "@/pages/Reports/_v2/ParamChips";
import { ReportBody } from "@/pages/Reports/_v2/ReportBody";
import { ReportFailureState, ReportLoadingState } from "@/pages/Reports/_v2/ReportStates";
import { failureOf, useReportV2 } from "@/pages/Reports/_v2/useReportV2";

export const WEAVING_EFFICIENCY_KEY = "maliyet/dokuma-verimlilik";
const ENTRY = REPORT_BY_KEY.get(WEAVING_EFFICIENCY_KEY)!;

/**
 * Dokuma maliyet verimliliği (SY-D3) — sunucunun v2 zarfını çizer; sayı tek kaynaktan (`weaving-actual-cost.helper`).
 * Uç maliyet ∧ dokuma ister: dokuma kapalıyken istek ATILMAZ (koşulsuz 403 yerine açıklama).
 */
export function WeavingEfficiencyPage() {
  const flags = useFeatureFlags();
  const weavingOn = flags.data?.data?.dokumaEnabled === true;
  const query = useReportV2(ENTRY, weavingOn);
  const data = query.data;
  const failure = query.isError ? failureOf(query.error) : null;

  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title={ENTRY.baslik}
        parent={{ label: "Maliyet Raporları", to: "/reports/maliyet" }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!weavingOn || query.isFetching} onClick={() => void query.refetch()} aria-label="Yenile">
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
            </Button>
            <ReportExportBar buildSpec={() => (data ? buildExportSpec(data) : null)} disabled={!data} />
          </div>
        }
      />
      <p className="border-b bg-muted/20 px-4 py-2 text-sm">
        <span className="font-medium">{ENTRY.soru}</span>
      </p>
      <ParamChips entry={ENTRY} params={data?.parametreler ?? []} personNamed={false} />
      <PageBody className="p-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          {flags.data && !weavingOn ? (
            <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
              Bu rapor dokuma modülü açık fabrikada çalışır; dokuma kapalı olduğu için gösterilecek iş yok.
            </p>
          ) : failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <ReportBody presentation={data} fetchedAt={query.dataUpdatedAt} />
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
