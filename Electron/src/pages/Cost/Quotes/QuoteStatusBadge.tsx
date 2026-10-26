import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE } from "./labels";
import type { QuoteStatus } from "./quote-types";

/** Durum rozeti + (yalnız SENT'te) sunucunun "süresi doldu" bayrağı — tarih panelde karşılaştırılmaz. */
export function QuoteStatusBadge({ status, expired }: { status: QuoteStatus; expired?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className={cn("whitespace-nowrap", QUOTE_STATUS_TONE[status])}>{QUOTE_STATUS_LABEL[status]}</Badge>
      {expired && <Badge variant="outline" className="whitespace-nowrap border-warning/50 text-warning">Süresi doldu</Badge>}
    </span>
  );
}
