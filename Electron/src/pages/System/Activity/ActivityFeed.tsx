import { formatDistanceToNow, format } from "date-fns";
import { tr } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { tableLabel, actionLabel, actionVariant } from "./labels";
import type { SystemLogListItem } from "@/types/systemLog";

interface Props {
  items: SystemLogListItem[];
  loading: boolean;
  onSelect: (item: SystemLogListItem) => void;
}

export function ActivityFeed({ items, loading, onSelect }: Props) {
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
      <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
        Filtreye uyan aktivite bulunamadı.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <ul className="divide-y">
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onSelect={() => onSelect(item)} />
        ))}
      </ul>
    </TooltipProvider>
  );
}

function ActivityRow({
  item,
  onSelect,
}: {
  item: SystemLogListItem;
  onSelect: () => void;
}) {
  const date = new Date(item.createdAt);
  const userLabel = item.user
    ? item.user.fullName || item.user.username
    : "Sistem";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <Badge variant={actionVariant(item.action)} className="shrink-0">
          {actionLabel(item.action)}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            <span className="font-medium">{userLabel}</span>{" "}
            <span className="text-muted-foreground">→</span>{" "}
            <span className="font-medium">{tableLabel(item.tableName)}</span>{" "}
            <span className="text-muted-foreground">kaydını {actionLabel(item.action)}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
            {item.recordId}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(date, { addSuffix: true, locale: tr })}
            </span>
          </TooltipTrigger>
          <TooltipContent side="left">
            {format(date, "dd.MM.yyyy HH:mm:ss", { locale: tr })}
          </TooltipContent>
        </Tooltip>
      </button>
    </li>
  );
}
