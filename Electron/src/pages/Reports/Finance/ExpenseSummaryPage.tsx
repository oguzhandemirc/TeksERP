import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ParamChips } from "@/pages/Reports/_v2/ParamChips";
import { ReportBody } from "@/pages/Reports/_v2/ReportBody";
import { ReportFailureState, ReportLoadingState } from "@/pages/Reports/_v2/ReportStates";
import { failureOf, useReportV2 } from "@/pages/Reports/_v2/useReportV2";

export const EXPENSE_SUMMARY_KEY = "finance/masraf-ozeti";
const ENTRY = REPORT_BY_KEY.get(EXPENSE_SUMMARY_KEY)!;
/** Sunucu satıra Masraf Özeti kovasının anahtarını koyar (`cashCategoryKey`); istemci anahtar ÜRETMEZ. */
export const EXPENSE_ROW_KEY_FIELD = "kategoriAnahtari";

/** Satır → o kategoriyle süzülmüş Kasa Hareketleri (`?category=<anahtar>`); anahtarsız satır (Toplam vb.) bağsız. */
export function expenseRowTarget(row: Record<string, unknown>): string | null {
  const key = row[EXPENSE_ROW_KEY_FIELD];
  return typeof key === "string" && key.length > 0 ? `/finance/cash-transactions?category=${encodeURIComponent(key)}` : null;
}

/**
 * Masraf Özeti (D4-H1) — sunucunun v2 zarfını çizer; rapor v2 bayrağından bağımsız (v2 üreteci bu anahtarı
 * `V2_KEYS_WITH_OWN_PAGE` ile atlar, adres tek route'ta kalır).
 * Sayı tek kaynaktan (`expense-summary.helper`): ekran, Excel ve PDF aynı `tablo`dan.
 */
export function ExpenseSummaryPage() {
  const navigate = useNavigate();
  // Kasa Hareketleri rotası `finance:read` ister; izinsiz kullanıcıya tıklanabilir satır (→ yasak sayfası) çizilmez.
  const canOpenCash = useRoleAccess().hasPermission("finance:read");
  const query = useReportV2(ENTRY);
  const data = query.data;
  const failure = query.isError ? failureOf(query.error) : null;

  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title={ENTRY.baslik}
        parent={{ label: "Ön Muhasebe Raporları", to: "/reports/finance" }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate("/finance/cash-transactions")}>
              Kasa Hareketleri
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Yenile">
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
          {failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <ReportBody
              presentation={data}
              fetchedAt={query.dataUpdatedAt}
              rowLink={canOpenCash ? { target: expenseRowTarget, open: (to) => navigate(to), title: "Bu kategorinin kasa hareketlerini aç" } : undefined}
            />
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
