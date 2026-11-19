// Açık oturumlar — ortak DataTable sütunları. Hücre tek satır: ikincil bilgi aynı satırda soluk yazılır.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { agoLabel, isOutdated } from "./clients-utils";
import { clientStamp } from "./clientsColumns";
import { sessionDeviceTitle, sessionTypeLabel } from "./sessions-utils";
import type { OpenSession } from "./sessions-service";

const Sub = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("ml-1.5 text-[11px] text-muted-foreground", className)}>{children}</span>
);

const userText = (s: OpenSession) => s.user.fullName ?? s.user.username;

interface Options {
  now: string;
  /** null = sonlandırma izni yok (sütun çizilmez). */
  onRevoke: ((s: OpenSession) => void) | null;
}

function sessionColumns({ now, onRevoke }: Options): ColumnDef<OpenSession>[] {
  const cols: ColumnDef<OpenSession>[] = [
    {
      id: "user",
      header: "Kullanıcı",
      meta: { label: "Kullanıcı", exportValue: userText },
      cell: ({ row: { original: s } }) => (
        <span className="font-medium">
          {userText(s)}
          <Sub>{`${s.user.username}${s.user.isSystemAccount ? " · en yetkili hesap" : ""}`}</Sub>
          {s.isCurrent && <Badge variant="muted" className="ml-1.5">bu oturum</Badge>}
        </span>
      ),
    },
    { id: "type", header: "Tür", meta: { label: "Tür", exportValue: (s) => sessionTypeLabel(s.deviceType) }, cell: ({ row }) => sessionTypeLabel(row.original.deviceType) },
    {
      id: "device",
      header: "Cihaz",
      meta: { label: "Cihaz", exportValue: (s) => sessionDeviceTitle(s) },
      cell: ({ row: { original: s } }) => <span className={cn(!s.deviceName && "text-muted-foreground")}>{sessionDeviceTitle(s)}</span>,
    },
    {
      id: "version",
      header: "Uygulama sürümü",
      meta: { label: "Uygulama sürümü", exportValue: (s) => s.clientVersion ?? "ölçülemedi" },
      cell: ({ row: { original: s } }) => {
        if (!s.clientVersion) return <span className="text-muted-foreground" title="Bu oturum açılırken istemci sürümünü bildirmedi">ölçülemedi</span>;
        const outdated = isOutdated(s.clientVersion, s.expectedVersion);
        return (
          <span>
            <span className={cn("tabular-nums", outdated && "font-medium text-warning")}>{s.clientVersion}</span>
            {outdated && <Sub className="text-warning">{`güncel değil (yayında ${s.expectedVersion})`}</Sub>}
          </span>
        );
      },
    },
    {
      id: "lastSeenAt",
      header: "Son görülme",
      meta: { label: "Son görülme", exportValue: (s) => (s.lastSeenAt ? clientStamp(s.lastSeenAt) : "istek yok") },
      cell: ({ row: { original: s } }) =>
        s.lastSeenAt ? (
          <span>
            {agoLabel(s.lastSeenAt, now)}
            <Sub>{clientStamp(s.lastSeenAt)}</Sub>
          </span>
        ) : (
          <span className="text-muted-foreground">Girişten beri istek yok</span>
        ),
    },
    {
      id: "createdAt",
      header: "Oturum açılışı",
      meta: { label: "Oturum açılışı", exportValue: (s) => clientStamp(s.createdAt) },
      cell: ({ row }) => clientStamp(row.original.createdAt),
    },
  ];
  if (onRevoke) {
    cols.push({
      id: "actions",
      header: "",
      enableSorting: false,
      meta: { label: "İşlem", align: "right", exportValue: () => "" },
      cell: ({ row: { original: s } }) =>
        s.isCurrent ? null : (
          <Button size="sm" variant="outline" className="h-7" onClick={() => onRevoke(s)}>
            Sonlandır
          </Button>
        ),
    });
  }
  return cols;
}

export function useOpenSessionsTable(sessions: OpenSession[], opts: Options) {
  const { now, onRevoke } = opts;
  const columns = useMemo(() => sessionColumns({ now, onRevoke }), [now, onRevoke]);
  return useLocalTable({ tableKey: "system:clients:sessions", data: sessions, columns, getRowId: (s) => s.id });
}
