import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isCenterEntryVisible } from "@/pages/Reports/_v2/center-model";

const REPORT_KEY = "production/kursun-gramaj";
export const REPORTS_V2_OFF_MESSAGE = "Raporlar v2 kapalı — Genel Ayarlar'dan açılır";

/**
 * "Kurşun Gramajı" raporuna kısa yol (KQ-D6 bulunabilirlik). Bayrak kapalıyken düğme
 * sessizce kaybolmaz, nedenini söyler (patron kararı); açıkken Rapor Merkezi'nin yüklemi.
 */
export function KursunGramajReportLink() {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const entry = REPORT_BY_KEY.get(REPORT_KEY);
  if (!entry || !ctx.flagsReady) return null;
  if (!ctx.reportsV2Enabled) {
    if (!isAdmin && !hasPermission(entry.izin)) return null;
    return (
      <Button variant="outline" size="sm" className="gap-1.5" title={REPORTS_V2_OFF_MESSAGE} onClick={() => toast.info(REPORTS_V2_OFF_MESSAGE)}>
        <BarChart3 className="h-4 w-4" /> Gramaj raporu
      </Button>
    );
  }
  if (!isCenterEntryVisible(entry, { isAdmin, hasPermission, ctx })) return null;
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link to={`/${entry.panelYolu}`}>
        <BarChart3 className="h-4 w-4" /> Gramaj raporu
      </Link>
    </Button>
  );
}
