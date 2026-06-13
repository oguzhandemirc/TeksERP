import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import { adminUserService } from "@/services/adminUserService";
import { permissionTemplateService } from "@/services/permissionTemplateService";

const MOBILE_TEMPLATE_PREFIX = "Mobil —";

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

  const templates = useQuery({
    queryKey: ["permission-templates"],
    queryFn: permissionTemplateService.list,
    staleTime: 5 * 60 * 1000,
  });

  const mobileTemplates = useMemo(
    () =>
      (templates.data?.data ?? []).filter((t) => t.name.startsWith(MOBILE_TEMPLATE_PREFIX)),
    [templates.data],
  );

  const initialIds = userPerms.data?.data?.map((g) => g.permissionId) ?? [];
  const [selected, setSelected] = useState<string[]>(initialIds);

  const applyMobileTemplate = (templateId: string) => {
    const tpl = mobileTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const ids = new Set(selected);
    for (const p of tpl.permissions) ids.add(p.permissionId);
    setSelected(Array.from(ids));
    toast.success(`${tpl.name} eklendi (kaydetmeyi unutmayın)`);
  };

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
      // O9 fix: yetkiler JWT'de taşınır (backend token'dan okur, DB'ye bakmaz) —
      // hedef kullanıcının açık oturumu (8 saate kadar) ESKİ yetkilerle devam
      // eder. Admin bunu bilsin; acil iptal gerekiyorsa kullanıcı çıkış yapmalı.
      toast.success("Yetkiler güncellendi.", {
        description:
          "Değişiklik, kullanıcı bir sonraki girişinde etkili olur — açık oturumu eski yetkilerle sürer.",
        duration: 8000,
      });
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
      {mobileTemplates.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Smartphone className="h-3.5 w-3.5" /> Mobil rol hızlı seç (mevcut yetkilere ekler)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {mobileTemplates.map((t) => (
              <Button
                key={t.id}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={mutation.isPending}
                onClick={() => applyMobileTemplate(t.id)}
                title={t.description ?? undefined}
              >
                {t.name.replace(`${MOBILE_TEMPLATE_PREFIX} `, "")}
              </Button>
            ))}
          </div>
        </div>
      )}
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
