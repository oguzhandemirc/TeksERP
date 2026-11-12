// Alarmlar listesi — özet şeridi (sunucu, listeyle aynı where) + satırlar; satır alarm sayfasını açar.
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { BandStats, type BandStatItem } from "@/components/layout/ListPage";
import { ALARM_STATE_LABEL, durationVsTarget, isLiveAlarm, isPastTarget, reasonText, tierLabel } from "./alarm-format";
import type { LoomAlarmItem, LoomAlarmScope, LoomAlarmSummary } from "./types";

export function AlarmSummaryStrip({ summary, scope }: { summary: LoomAlarmSummary; scope: LoomAlarmScope }) {
  const items: BandStatItem[] = [{ key: "total", label: "Toplam", value: summary.total }];
  if (scope !== "history") {
    items.push({ key: "open", label: "Açık (üstlenilmedi)", value: summary.open, tone: summary.open > 0 ? "danger" : undefined });
    items.push({ key: "acked", label: "Üstlenildi", value: summary.acked });
  }
  if (scope !== "active") {
    items.push({ key: "resolved", label: "Çözüldü", value: summary.resolved });
    items.push({ key: "cancelled", label: "İptal", value: summary.cancelled });
  }
  items.push({ key: "escalated", label: "Patrona iletilen", value: summary.escalated, tone: summary.escalated > 0 ? "warn" : undefined });
  return <BandStats label="Özet" items={items} />;
}

interface TableProps {
  items: LoomAlarmItem[];
  now: number;
  onOpen: (id: string) => void;
}

export function LoomAlarmsTable({ items, now, onOpen }: TableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="px-3 py-2 font-medium">Tezgah</th>
          <th className="px-3 py-2 font-medium">Sebep</th>
          <th className="px-3 py-2 font-medium">Başladı</th>
          <th className="px-3 py-2 text-right font-medium">Süre</th>
          <th className="px-3 py-2 font-medium">Kademe</th>
          <th className="px-3 py-2 font-medium">Durum</th>
          <th className="px-3 py-2 font-medium">Üstlenen</th>
        </tr>
      </thead>
      <tbody>
        {items.map((a) => {
          const live = isLiveAlarm(a.state);
          return (
            <tr
              key={a.id}
              tabIndex={0}
              onClick={() => onOpen(a.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(a.id)}
              className="cursor-pointer border-b transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:outline-none"
            >
              <td className="px-3 py-2.5">
                <span className="font-semibold">{a.machine.code}</span>
                <span className="block text-xs text-muted-foreground">{a.machine.hallName}</span>
              </td>
              <td className="px-3 py-2.5">{reasonText(a)}</td>
              <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{fmtFactoryDateTime(a.stop.startedAt)}</td>
              <td className={cn("px-3 py-2.5 text-right tabular-nums", live && isPastTarget(a, now) && "font-semibold text-destructive")}>
                {durationVsTarget(a, now)}
              </td>
              <td className="px-3 py-2.5">
                <Badge variant={a.tier >= 2 ? (live ? "destructive" : "secondary") : "muted"} className="whitespace-nowrap">
                  {tierLabel(a.tier)}
                </Badge>
              </td>
              <td className="px-3 py-2.5">{ALARM_STATE_LABEL[a.state] ?? a.state}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{a.ackedBy?.name ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
