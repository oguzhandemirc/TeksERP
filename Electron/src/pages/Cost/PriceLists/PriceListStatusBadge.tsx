import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PRICE_LIST_STATUS_LABEL, type PriceListStatus } from "./pl-types";

const TONE: Record<PriceListStatus, string> = { DRAFT: "text-muted-foreground", PUBLISHED: "border-success/50 text-success", ARCHIVED: "text-muted-foreground line-through" };

export function PriceListStatusBadge({ status }: { status: PriceListStatus }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap", TONE[status])}>{PRICE_LIST_STATUS_LABEL[status]}</Badge>;
}
