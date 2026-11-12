// Kullanıcılar — ortak DataTable sütunları. Eylemler: ayak izi (Ctrl/⌘/orta tık → yeni sekme), yönet, pasife al/aktifleştir, sil.
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { MouseEvent } from "react";
import { History, Power, PowerOff, Trash2, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocalTable } from "@/hooks/useLocalTable";
import { safeFormat } from "@/lib/format";
import type { AdminUserListItem } from "@/services/adminUserService";

export interface UserRowActions {
  onFootprint: (u: AdminUserListItem, e: MouseEvent) => void;
  onManage: (u: AdminUserListItem) => void;
  onDeactivate: (u: AdminUserListItem) => void;
  onReactivate: (u: AdminUserListItem) => void;
  onDelete: (u: AdminUserListItem) => void;
  deactivating: boolean;
  reactivating: boolean;
}

// En yetkili hesapta sayı 0'dır (grant satırı yazılmaz) — "yetkisiz" gibi okunmasın.
const permissionText = (u: AdminUserListItem) => (u.isSystemAccount ? "Tüm yetkiler" : `${u._count.permissions} yetki`);
const permissionVariant = (u: AdminUserListItem) => (u.isSystemAccount ? "default" : u._count.permissions === 0 ? "secondary" : "muted");

function RowActions({ u, a }: { u: AdminUserListItem; a: UserRowActions }) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1"
        title="Ayak izi (çalışma oturumları + işlem dökümü)"
        onClick={(e) => a.onFootprint(u, e)}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            a.onFootprint(u, e);
          }
        }}
      >
        <History className="h-3.5 w-3.5" /> Ayak İzi
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => a.onManage(u)}>
        <UserCog className="h-3.5 w-3.5" /> Yönet
      </Button>
      {/* Pasife Al (aktifse) / Aktifleştir (pasifse) — GERİ ALINABİLİR */}
      {u.isActive ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Pasife al (geri alınabilir)" disabled={a.deactivating} onClick={() => a.onDeactivate(u)}>
          <PowerOff className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7 text-success" title="Aktifleştir" disabled={a.reactivating} onClick={() => a.onReactivate(u)}>
          <Power className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Kalıcı sil (geri alınamaz)" onClick={() => a.onDelete(u)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function userColumns(actions: { current: UserRowActions }): ColumnDef<AdminUserListItem>[] {
  return [
    { accessorKey: "username", header: "Kullanıcı", meta: { label: "Kullanıcı" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.username}</span> },
    { accessorKey: "fullName", header: "Ad Soyad", meta: { label: "Ad Soyad" } },
    {
      id: "permissions",
      header: "Yetki",
      meta: { label: "Yetki", exportValue: permissionText },
      cell: ({ row }) => <Badge variant={permissionVariant(row.original)}>{permissionText(row.original)}</Badge>,
    },
    {
      id: "isActive",
      header: "Durum",
      meta: { label: "Durum", exportValue: (u) => (u.isActive ? "Aktif" : "Pasif") },
      cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
    },
    {
      accessorKey: "createdAt",
      header: "Oluşturma",
      meta: { label: "Oluşturma", exportValue: (u) => safeFormat(u.createdAt, "dd.MM.yyyy") },
      cell: ({ row }) => <span className="tabular-nums">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>,
    },
    { id: "actions", header: "", size: 260, enableSorting: false, cell: ({ row }) => <RowActions u={row.original} a={actions.current} /> },
  ];
}

export function useAccessUsersTable(rows: AdminUserListItem[], actions: UserRowActions) {
  // Eylem geri çağrıları her render'da yenidir; sütunlar bir kez kurulur, düğmeler güncel eylemi okur.
  const ref = useRef(actions);
  ref.current = actions;
  const columns = useMemo(() => userColumns(ref), []);
  return useLocalTable({ tableKey: "access:users", data: rows, columns });
}
