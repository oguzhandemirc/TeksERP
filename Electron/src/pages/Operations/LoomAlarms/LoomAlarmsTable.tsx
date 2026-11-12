// Alarmlar listesi — özet şeridi (sunucu, listeyle aynı where) + satırlar; satır alarm sayfasını açar.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
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

const ALARM_COLUMNS = (now: number): ColumnDef<LoomAlarmItem>[] => [
  {
    id: "machine",
    header: "Tezgah",
    meta: { label: "Tezgah", exportValue: (a) => `${a.machine.code} ${a.machine.hallName ?? ""}`.trim() },
    cell: ({ row: { original: a } }) => (
      <span>
        <span className="font-semibold">{a.machine.code}</span>
        <span className="ml-1.5 text-xs text-muted-foreground">{a.machine.hallName}</span>
      </span>
    ),
  },
  { id: "reason", header: "Sebep", size: 220, meta: { label: "Sebep", exportValue: reasonText }, cell: ({ row }) => reasonText(row.original) },
  {
    id: "startedAt",
    header: "Başladı",
    meta: { label: "Başladı", exportValue: (a) => fmtFactoryDateTime(a.stop.startedAt) },
    cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{fmtFactoryDateTime(row.original.stop.startedAt)}</span>,
  },
  {
    id: "duration",
    header: "Süre",
    meta: { label: "Süre", align: "right", exportValue: (a) => durationVsTarget(a, now) },
    cell: ({ row: { original: a } }) => (
      <span className={cn("tabular-nums", isLiveAlarm(a.state) && isPastTarget(a, now) && "font-semibold text-destructive")}>{durationVsTarget(a, now)}</span>
    ),
  },
  {
    id: "tier",
    header: "Kademe",
    meta: { label: "Kademe", exportValue: (a) => tierLabel(a.tier) },
    cell: ({ row: { original: a } }) => (
      <Badge variant={a.tier >= 2 ? (isLiveAlarm(a.state) ? "destructive" : "secondary") : "muted"} className="whitespace-nowrap">
        {tierLabel(a.tier)}
      </Badge>
    ),
  },
  { id: "state", header: "Durum", meta: { label: "Durum", exportValue: (a) => ALARM_STATE_LABEL[a.state] ?? a.state }, cell: ({ row }) => ALARM_STATE_LABEL[row.original.state] ?? row.original.state },
  { id: "ackedBy", header: "Üstlenen", meta: { label: "Üstlenen", exportValue: (a) => a.ackedBy?.name ?? "" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.ackedBy?.name ?? "—"}</span> },
];

/** Süre sütunu sunucu saatine göre akar (`now` 15 sn'de bir) — sütunlar yalnız o değişince yenilenir. */
export function useLoomAlarmsTable(items: LoomAlarmItem[], now: number) {
  const columns = useMemo(() => ALARM_COLUMNS(now), [now]);
  return useLocalTable({ tableKey: "loom-alarms:list", data: items, columns });
}
