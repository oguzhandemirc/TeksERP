import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import { adminUserService } from "@/services/adminUserService";

interface Props {
  userId: string;
}

const CATALOG_KEY = "permission-catalog";

export function PermissionsTab({ userId }: Props) {
  const qc = useQueryClient();
  const userKey = ["admin-user-permissions", userId];

  const catalog = useQuery({
    queryKey: [CATALOG_KEY],
    queryFn: permissionCatalogService.list,
    staleTime: 5 * 60 * 1000,
  });

  const userPerms = useQuery({
    queryKey: userKey,
    queryFn: () => adminUserService.getPermissions(userId),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const initialIds = userPerms.data?.data?.map((g) => g.permissionId) ?? [];
  const [selected, setSelected] = useState<string[]>(initialIds);

  useEffect(() => {
    if (userPerms.data) setSelected(userPerms.data.data.map((g) => g.permissionId));
  }, [userPerms.data]);

  const dirty =
    selected.length !== initialIds.length ||
    selected.some((id) => !initialIds.includes(id)) ||
    initialIds.some((id) => !selected.includes(id));

  const mutation = useMutation({
    mutationFn: (ids: string[]) => adminUserService.setPermissions(userId, ids),
    onSuccess: () => {
      toast.success("Yetkiler güncellendi.");
      void qc.invalidateQueries({ queryKey: userKey });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  if (catalog.isLoading || userPerms.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col gap-3">
      <div className="min-h-0 flex-1">
        <PermissionGrid
          permissions={catalog.data?.data ?? []}
          value={selected}
          onChange={setSelected}
          disabled={mutation.isPending}
        />
      </div>
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => setSelected(initialIds)}
        >
          Sıfırla
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate(selected)}
        >
          <Save className="h-4 w-4" /> {mutation.isPending ? "Kaydediliyor..." : "Yetkileri Kaydet"}
        </Button>
      </div>
    </div>
  );
}
