import { memo } from "react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { ChevronRight } from "lucide-react";
import { formatFactory } from "@/lib/factory-time";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AuditNarrativeRow } from "@/components/audit/AuditNarrativeRow";
import { cn } from "@/lib/utils";
import { tableLabel, actionLabel, actionVariant } from "./labels";
import { isIslemItem, itemUser, type FeedItem } from "./activity-view";
import type { SystemLogListItem } from "@/types/systemLog";

interface Props {
  items: FeedItem[];
  loading: boolean;
  onSelect: (item: FeedItem) => void;
  /** Boş listede gösterilecek metin (arama uyarısı vb.). */
  emptyText?: string;
}

// Akış SUNUCUNUN döndürdüğünü olduğu gibi çizer: süzme/sayma yok (süzgeçler
// sorgu parametresidir). Cümleyi `AuditNarrativeRow` çizer — ⓘ Geçmiş ile aynı.
export function ActivityFeed({ items, loading, onSelect, emptyText }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-center text-sm text-muted-foreground">
        {emptyText ?? "Filtreye uyan işlem bulunamadı."}
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ul className="divide-y" data-testid="activity-feed">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </ul>
    </TooltipProvider>
  );
}

// Perf: React.memo + stabil onSelect(item) → daha fazla yüklendiğinde önceki
// satırların (her biri formatDistanceToNow + Radix Tooltip) yeniden çizimi önlenir.
const ActivityRow = memo(function ActivityRow({
  item,
  onSelect,
}: {
  item: FeedItem;
  onSelect: (item: FeedItem) => void;
}) {
  const date = new Date(item.createdAt);
  const islem = isIslemItem(item) ? item : null;
  const reddedildi = !!islem?.reddedildi;

  return (
    <li>
      {/* Satır içinde kayıt bağlantısı olduğu için <button> değil: iç içe etkileşim yasak. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(item)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(item);
          }
        }}
        className={cn(
          "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none sm:px-6",
          reddedildi && "bg-red-50/60 dark:bg-red-950/20",
        )}
        data-testid={reddedildi ? "activity-row-rejected" : "activity-row"}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="w-12 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {formatFactory(date, "HH:mm")}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {formatFactory(date, "dd.MM.yyyy HH:mm:ss")} ·{" "}
            {formatDistanceToNow(date, { addSuffix: true, locale: tr })}
          </TooltipContent>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <AuditNarrativeRow
            anlati={item.anlati}
            reddedildi={reddedildi}
            truncate
            fallback={islem ? <span className="text-sm">{itemUser(item)}</span> : <LegacyLine item={item as SystemLogListItem} />}
          />
          {!islem && (item as SystemLogListItem).kardes && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">aynı işlemde</div>
          )}
        </div>
        {islem && islem.kayitSayisi > 1 && (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Ayrıntı" />
        )}
      </div>
    </li>
  );
});

/** Eski backend (anlatı yok) satırı — bugünkü düzen. */
function LegacyLine({ item }: { item: SystemLogListItem }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant={actionVariant(item.action)} className="shrink-0">
        {actionLabel(item.action)}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" data-testid="activity-legacy-line">
          <span className="font-medium">{itemUser(item)}</span>{" "}
          <span className="text-muted-foreground">→</span>{" "}
          <span className="font-medium">{tableLabel(item.tableName)}</span>{" "}
          <span className="text-muted-foreground">kaydını {actionLabel(item.action)}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">{item.recordId}</div>
      </div>
    </div>
  );
}
