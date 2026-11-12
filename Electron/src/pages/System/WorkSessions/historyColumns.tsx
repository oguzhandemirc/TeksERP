// Oturum geçmişi — ortak DataTable sütunları. Cihaz adı işlem dökümünü açar (Ctrl/⌘/orta tık → yeni sekme).
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
import { safeFormat } from "@/lib/format";
import type { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { endReasonLabels, formatDurationMinutes, placeLabel, sessionDurationMinutes, type WorkSessionItem } from "./types";

type OpenTarget = ReturnType<typeof useOpenTarget>;
type OpenPath = (path: string, e?: Parameters<OpenTarget>[1]) => void;

const stampText = (iso: string) => safeFormat(iso, "dd.MM.yyyy HH:mm");
const durationText = (s: WorkSessionItem) => formatDurationMinutes(sessionDurationMinutes(s.startedAt, s.endedAt));

function historyColumns(openTarget: OpenPath): ColumnDef<WorkSessionItem>[] {
  return [
    { id: "user", header: "Kullanıcı", meta: { label: "Kullanıcı", exportValue: (s) => s.user.fullName }, cell: ({ row }) => <span className="font-medium">{row.original.user.fullName}</span> },
    {
      id: "place",
      header: "Yer",
      meta: { label: "Yer", exportValue: (s) => [placeLabel(s), s.machine?.code].filter(Boolean).join(" ") },
      cell: ({ row: { original: s } }) => (
        <span>
          {placeLabel(s)}
          {s.machine && <span className="ml-1 font-mono text-xs text-muted-foreground">{s.machine.code}</span>}
        </span>
      ),
    },
    {
      id: "device",
      header: "Cihaz",
      meta: { label: "Cihaz", exportValue: (s) => s.device.name },
      cell: ({ row: { original: s } }) => (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          title="Cihaz işlem dökümü"
          onClick={(e) => openTarget(`/access/devices/${s.device.id}`, e)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              openTarget(`/access/devices/${s.device.id}`, e);
            }
          }}
        >
          {s.device.name}
        </button>
      ),
    },
    { id: "startedAt", header: "Başlangıç", meta: { label: "Başlangıç", exportValue: (s) => stampText(s.startedAt) }, cell: ({ row }) => <span className="text-xs tabular-nums">{stampText(row.original.startedAt)}</span> },
    {
      id: "endedAt",
      header: "Bitiş",
      meta: { label: "Bitiş", exportValue: (s) => (s.endedAt ? stampText(s.endedAt) : "Açık") },
      cell: ({ row: { original: s } }) => (s.endedAt ? <span className="text-xs tabular-nums">{stampText(s.endedAt)}</span> : <Badge>Açık</Badge>),
    },
    {
      id: "duration",
      header: "Süre",
      meta: { label: "Süre", align: "right", exportValue: durationText },
      cell: ({ row }) => <span className="text-xs tabular-nums">{durationText(row.original)}</span>,
    },
    {
      id: "endReason",
      header: "Kapanış",
      meta: { label: "Kapanış", exportValue: (s) => (s.endReason ? endReasonLabels[s.endReason] : "") },
      cell: ({ row: { original: s } }) =>
        s.endReason ? (
          <Badge variant={s.endReason === "ADMIN" || s.endReason === "TAKEOVER" ? "muted" : "outline"}>{endReasonLabels[s.endReason]}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];
}

export function useSessionHistoryTable(rows: WorkSessionItem[], openTarget: OpenTarget) {
  // Açıcı her render'da yenidir; sütunlar bir kez kurulur, çağrı güncel açıcıya gider.
  const opener = useRef(openTarget);
  opener.current = openTarget;
  const columns = useMemo(() => historyColumns((path, e) => opener.current(path, e)), []);
  return useLocalTable({ tableKey: "work-sessions:history", data: rows, columns });
}
