import { Link } from "react-router-dom";
import { History } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { SYSTEM_PRINT_HISTORY_ACCESS } from "@/lib/permissions";
import { printHistoryHref } from "@/lib/print-history-query";
import { cn } from "@/lib/utils";

/** Kayıt detayından o kaydın baskılarına (`?subjectId=`) — sayfayla AYNI izin kümesi. */
export function PrintHistoryLink({ subjectId, className }: { subjectId: string | null | undefined; className?: string }) {
  if (!subjectId) return null;
  return (
    <PermissionGate anyOf={SYSTEM_PRINT_HISTORY_ACCESS}>
      <Link
        to={printHistoryHref(subjectId)}
        className={cn("inline-flex items-center gap-1 text-xs text-primary hover:underline", className)}
        data-testid="print-history-link"
      >
        <History className="h-3.5 w-3.5" />
        Baskı geçmişi
      </Link>
    </PermissionGate>
  );
}
