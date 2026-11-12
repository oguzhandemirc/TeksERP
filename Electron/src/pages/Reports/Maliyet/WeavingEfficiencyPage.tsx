import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";

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
  return (
    <PageShell className="overflow-hidden">
      <ReportV2Frame
        entry={ENTRY}
        query={query}
        parent={{ label: "Maliyet Raporları", to: "/reports/maliyet" }}
        personNamed={false}
        blockedNote={flags.data && !weavingOn ? "Bu rapor dokuma modülü açık fabrikada çalışır; dokuma kapalı olduğu için gösterilecek iş yok." : undefined}
      />
    </PageShell>
  );
}
