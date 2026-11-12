// Bağlı istemciler — ortak DataTable sütunları. Hücre tek satır: ikincil bilgi aynı satırda soluk yazılır.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
import { factoryLocaleString } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { agoLabel, clientTitle, isOutdated, kindLabel } from "./clients-utils";
import type { ConnectedClient } from "./service";

export const clientStamp = (iso: string): string => factoryLocaleString(iso, "tr-TR");

const NOT_DECLARED = "sürümünü bildirmiyor — adres bilgisinden okundu";

function versionNotes(c: ConnectedClient): string[] {
  const notes: string[] = [];
  if (isOutdated(c.version, c.expectedVersion)) notes.push(`güncel değil (yayında ${c.expectedVersion})`);
  // Çıkarılmış sürümü beyan edilmiş gibi göstermek okuyucuyu yanıltır (künye başlıkları 2026-09-04'te geldi).
  if (!c.declared) notes.push(NOT_DECLARED);
  return notes;
}

const userText = (c: ConnectedClient) => (c.lastUser ? (c.lastUser.fullName ?? c.lastUser.username) : "Bilinmiyor");
const userSub = (u: NonNullable<ConnectedClient["lastUser"]>) => `${u.username}${u.isSystemAccount ? " · en yetkili hesap" : ""}`;

const Sub = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("ml-1.5 text-[11px] text-muted-foreground", className)}>{children}</span>
);

function clientColumns(now: string): ColumnDef<ConnectedClient>[] {
  return [
    {
      id: "client",
      header: "Kurulum",
      meta: { label: "Kurulum", exportValue: (c) => clientTitle(c.deviceName, c.instanceId) },
      cell: ({ row: { original: c } }) => (
        <span className="font-medium">
          {clientTitle(c.deviceName, c.instanceId)}
          <Sub className="font-mono">{c.instanceId.slice(0, 8)}</Sub>
        </span>
      ),
    },
    { id: "kind", header: "Tür", meta: { label: "Tür", exportValue: (c) => kindLabel(c.kind) }, cell: ({ row }) => kindLabel(row.original.kind) },
    {
      id: "version",
      header: "Sürüm",
      meta: { label: "Sürüm", exportValue: (c) => [c.version ?? "—", ...versionNotes(c)].join(" · ") },
      cell: ({ row: { original: c } }) => {
        const outdated = isOutdated(c.version, c.expectedVersion);
        const notes = versionNotes(c);
        return (
          <span title={notes.join(" · ") || undefined}>
            {c.version ? (
              <span className={cn("tabular-nums", outdated && "font-medium text-warning")}>{c.version}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {notes.length > 0 && <Sub className={outdated ? "text-warning" : undefined}>{notes.join(" · ")}</Sub>}
          </span>
        );
      },
    },
    {
      id: "lastUser",
      header: "Son kullanıcı",
      meta: { label: "Son kullanıcı", exportValue: userText },
      cell: ({ row: { original: c } }) =>
        c.lastUser ? (
          <span>
            {userText(c)}
            <Sub>{userSub(c.lastUser)}</Sub>
          </span>
        ) : (
          // null = kimliksiz istek (giriş ekranı). "Kimse yok" DEĞİL.
          <span className="text-muted-foreground">Bilinmiyor</span>
        ),
    },
    {
      id: "lastSeenAt",
      header: "Son görülme",
      meta: { label: "Son görülme", exportValue: (c) => clientStamp(c.lastSeenAt) },
      cell: ({ row: { original: c } }) => (
        <span>
          {agoLabel(c.lastSeenAt, now)}
          <Sub>{clientStamp(c.lastSeenAt)}</Sub>
        </span>
      ),
    },
    {
      id: "active",
      header: "Durum",
      meta: { label: "Durum", align: "right", exportValue: (c) => (c.active ? "Aktif" : "Pasif") },
      cell: ({ row: { original: c } }) => <Badge variant={c.active ? "default" : "muted"}>{c.active ? "Aktif" : "Pasif"}</Badge>,
    },
  ];
}

export function useClientsTable(clients: ConnectedClient[], now: string) {
  const columns = useMemo(() => clientColumns(now), [now]);
  return useLocalTable({ tableKey: "system:clients", data: clients, columns, getRowId: (c) => c.instanceId });
}
