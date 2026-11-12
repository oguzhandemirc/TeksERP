import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";

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
  return (
    <PageShell className="overflow-hidden">
      <ReportV2Frame
        entry={ENTRY}
        query={query}
        parent={{ label: "Ön Muhasebe Raporları", to: "/reports/finance" }}
        personNamed={false}
        leadingActions={
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => navigate("/finance/cash-transactions")}>
            Kasa Hareketleri
          </Button>
        }
        rowLink={canOpenCash ? { target: expenseRowTarget, open: (to) => navigate(to), title: "Bu kategorinin kasa hareketlerini aç" } : undefined}
      />
    </PageShell>
  );
}
