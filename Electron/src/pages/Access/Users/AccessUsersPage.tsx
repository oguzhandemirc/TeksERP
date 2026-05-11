import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import apiClient from "@/services/apiClient";
import {
  adminUserService,
  type AdminUserListItem,
} from "@/services/adminUserService";
import type { ApiResponse } from "@/types/api";
import { UserFormDialog, type UserFormValues } from "./UserFormDialog";
import { UserDetailSheet } from "./UserDetailSheet";

const QUERY_KEY = "admin-users";

interface UserPayload {
  username?: string;
  fullName?: string;
  password?: string;
  isActive?: boolean;
}

const userMutations = {
  create: (data: UserPayload) =>
    apiClient.post<ApiResponse<AdminUserListItem>>("/api/admin/users", data).then((r) => r.data),
  update: (id: string, data: UserPayload) =>
    apiClient.patch<ApiResponse<AdminUserListItem>>(`/api/admin/users/${id}`, data).then((r) => r.data),
  remove: (id: string) =>
    apiClient.delete<ApiResponse<AdminUserListItem>>(`/api/admin/users/${id}`).then((r) => r.data),
};

export function AccessUsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserListItem | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<AdminUserListItem | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: adminUserService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const list = (query.data?.data ?? []).filter((u) => u.isActive);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (u) => u.username.toLowerCase().includes(q) || u.fullName.toLowerCase().includes(q),
    );
  }, [query.data, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  const createMut = useMutation({
    mutationFn: userMutations.create,
    onSuccess: () => {
      toast.success("Kullanıcı oluşturuldu.");
      invalidate();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UserPayload }) => userMutations.update(id, data),
    onSuccess: () => {
      toast.success("Kullanıcı güncellendi.");
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: userMutations.remove,
    onSuccess: () => {
      toast.success("Kullanıcı pasife alındı.");
      invalidate();
    },
  });

  const onSubmit = async (values: UserFormValues) => {
    const payload: UserPayload = {
      username: values.username,
      fullName: values.fullName,
      isActive: values.isActive,
    };
    if (values.password) payload.password = values.password;
    if (editing) await updateMut.mutateAsync({ id: editing.id, data: payload });
    else await createMut.mutateAsync(payload);
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Kullanıcılar"
        description="Sistem kullanıcılarını ve yetkilerini yönet."
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Yeni Kullanıcı
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Kullanıcı adı veya ad soyad ara..."
          className="h-8 w-64 text-sm"
        />
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Kullanıcı</TableHead>
              <TableHead>Ad Soyad</TableHead>
              <TableHead>Yetki</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Oluşturma</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  Kullanıcı bulunamadı.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-xs">{user.username}</TableCell>
                  <TableCell>{user.fullName}</TableCell>
                  <TableCell>
                    <Badge variant={user._count.permissions === 0 ? "secondary" : "muted"}>
                      {user._count.permissions} yetki
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>}
                  </TableCell>
                  <TableCell>{safeFormat(user.createdAt, "dd.MM.yyyy")}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1"
                        onClick={() => setPermissionsFor(user)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Yetkiler
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditing(user);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setRemovingId(user.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <UserFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSubmit={onSubmit}
        isSubmitting={createMut.isPending || updateMut.isPending}
      />

      <UserDetailSheet
        user={permissionsFor}
        open={Boolean(permissionsFor)}
        onOpenChange={(open) => !open && setPermissionsFor(null)}
      />

      <ConfirmDialog
        open={Boolean(removingId)}
        onOpenChange={(open) => !open && setRemovingId(null)}
        title="Kullanıcıyı sil"
        description="Bu işlem kullanıcıyı pasife alır. Veritabanında kayıt korunur ama listede görünmez."
        confirmLabel="Sil"
        destructive
        isPending={removeMut.isPending}
        onConfirm={async () => {
          if (!removingId) return;
          await removeMut.mutateAsync(removingId);
          setRemovingId(null);
        }}
      />
    </div>
  );
}
