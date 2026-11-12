import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { isCenterEntryVisible } from "@/pages/Reports/_v2/center-model";

const REPORT_KEY = "production/kursun-gramaj";

/**
 * "Kurşun Gramajı" raporuna kısa yol (KQ-D6 bulunabilirlik) — görünürlük Rapor Merkezi'nin yüklemi.
 */
export function KursunGramajReportLink() {
  const { isAdmin, hasPermission } = useRoleAccess();
  const ctx = useOperationsVisibilityContext();
  const entry = REPORT_BY_KEY.get(REPORT_KEY);
  if (!entry || !ctx.flagsReady) return null;
  if (!isCenterEntryVisible(entry, { isAdmin, hasPermission, ctx })) return null;
  return (
    <Button asChild variant="outline" size="sm" className="gap-1.5">
      <Link to={`/${entry.panelYolu}`}>
        <BarChart3 className="h-4 w-4" /> Gramaj raporu
      </Link>
    </Button>
  );
}
