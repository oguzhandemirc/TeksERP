import { PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";

export const MACHINE_STOPS_REPORT_KEY = "production/makine-duruslari";
const ENTRY = REPORT_BY_KEY.get(MACHINE_STOPS_REPORT_KEY)!;

/**
 * Makine Duruşları raporu (D4-A4) — sunucunun v2 zarfını çizer; rapor v2 bayrağından bağımsız
 * (`V2_KEYS_WITH_OWN_PAGE`). Sayı, anlatı ve "sürüyor" işareti sunucudan: ekran, Excel ve PDF aynı zarftan.
 */
export function MachineStopsReportPage() {
  const query = useReportV2(ENTRY);
  return (
    <PageShell className="overflow-hidden">
      <ReportV2Frame entry={ENTRY} query={query} parent={{ label: "Üretim Raporları", to: "/reports/production" }} personNamed={false} />
    </PageShell>
  );
}
