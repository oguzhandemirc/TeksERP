import { memo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  categoryLabels,
  categoryVariants,
  eventActionLabel,
  eventActionVariant,
} from "./labels";
import type { SystemLogListItem } from "@/types/systemLog";

interface Props {
  items: SystemLogListItem[];
  loading: boolean;
  onSelect: (item: SystemLogListItem) => void;
}

export function SystemEventsList({ items, loading, onSelect }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
        Filtreye uyan sistem kaydı bulunamadı.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* Gerçek kaydırıcı üst PageBody; burada overflow-auto YOK — böylece sticky
          başlık (thead) sayfa gövdesine göre yapışır (yoksa asla kaymayan iç kutuya
          yapışıp içerikle birlikte kayıp giderdi). */}
      <div>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card/80 backdrop-blur">
            <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 font-medium">Tarih</th>
              <th className="px-3 py-2 font-medium">Kategori</th>
              <th className="px-3 py-2 font-medium">Olay</th>
              <th className="px-3 py-2 font-medium">Hedef</th>
              <th className="px-3 py-2 font-medium">Kullanıcı</th>
              <th className="px-3 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <EventRow key={item.id} item={item} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

// Perf: React.memo + stabil onSelect(item) → load-more ile satır eklenince tüm
// birikmiş satırların (formatDistanceToNow + per-row Radix Tooltip) yeniden
// render'ını önler.
const EventRow = memo(function EventRow({
  item,
  onSelect,
}: {
  item: SystemLogListItem;
  onSelect: (item: SystemLogListItem) => void;
}) {
  const date = new Date(item.createdAt);
  const userLabel = item.user
    ? item.user.fullName || item.user.username
    : "-";

  return (
    <tr
      onClick={() => onSelect(item)}
      className="cursor-pointer border-b transition-colors hover:bg-accent/40"
    >
      <td className="whitespace-nowrap px-6 py-2 text-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              {formatDistanceToNow(date, { addSuffix: true, locale: tr })}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {format(date, "dd.MM.yyyy HH:mm:ss", { locale: tr })}
          </TooltipContent>
        </Tooltip>
      </td>
      <td className="px-3 py-2">
        <Badge variant={categoryVariants[item.category]} className="shrink-0">
          {categoryLabels[item.category]}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <Badge variant={eventActionVariant(item.action)} className="shrink-0">
          {eventActionLabel(item.action)}
        </Badge>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {item.recordId === "-" ? "" : item.recordId}
      </td>
      <td className="px-3 py-2 text-xs">{userLabel}</td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
        {item.ipAddress ?? ""}
      </td>
    </tr>
  );
});
