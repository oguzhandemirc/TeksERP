import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import { adminUserService, type PermissionSetItem } from "@/services/adminUserService";
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

  const grants = userPerms.data?.data ?? [];
  const initialIds = grants.map((g) => g.permissionId);
  // Süreli izinler: permissionId → "YYYY-MM-DD" (bitiş tarihi). validUntil ISO'dan gün
  // kısmını al (UTC gece yarısı damgalandığı için slice drift'siz round-trip eder).
  const initialDates: Record<string, string> = {};
  for (const g of grants) if (g.validUntil) initialDates[g.permissionId] = g.validUntil.slice(0, 10);

  const [selected, setSelected] = useState<string[]>(initialIds);
  const [dates, setDates] = useState<Record<string, string>>(initialDates);

  const applyMobileTemplate = (templateId: string) => {
    const tpl = mobileTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const ids = new Set(selected);
    for (const p of tpl.permissions) ids.add(p.permissionId);
    setSelected(Array.from(ids));
    toast.success(`${tpl.name} eklendi (kaydetmeyi unutmayın)`);
  };

  useEffect(() => {
    if (!userPerms.data) return;
    const g = userPerms.data.data;
    setSelected(g.map((x) => x.permissionId));
    const d: Record<string, string> = {};
    for (const x of g) if (x.validUntil) d[x.permissionId] = x.validUntil.slice(0, 10);
    setDates(d);
  }, [userPerms.data]);

  const handleDateChange = (permissionId: string, value: string) => {
    setDates((prev) => {
      const next = { ...prev };
      if (value) next[permissionId] = value;
      else delete next[permissionId];
      return next;
    });
  };

  const selectionDirty =
    selected.length !== initialIds.length ||
    selected.some((id) => !initialIds.includes(id)) ||
    initialIds.some((id) => !selected.includes(id));
  // Yalnız seçili izinlerin tarihi anlamlı; seçili değilse tarih payload'a girmez.
  const datesDirty = selected.some((id) => (dates[id] ?? "") !== (initialDates[id] ?? ""));
  const dirty = selectionDirty || datesDirty;

  const reset = () => {
    setSelected(initialIds);
    setDates(initialDates);
  };

  const mutation = useMutation({
    mutationFn: (items: PermissionSetItem[]) => adminUserService.setPermissions(userId, items),
    onSuccess: () => {
      // Yetki/süre değişimi backend'de tokenVersion++ tetikler → hedef kullanıcının açık
      // oturumu bir sonraki istekte 401 alıp sonlanır (yeniden giriş gerekir). Süreli
      // izinlerde yeni token'ın ömrü en yakın bitiş tarihine çekilir → tarih dolunca
      // oturum kendiliğinden biter.
      toast.success("Yetkiler güncellendi.", {
        description:
          "Değişiklik hemen geçerli olur; kullanıcının açık oturumu bir sonraki işlemde sonlanır ve yeniden giriş ister. Süreli (bitiş tarihli) izinlerde, tarih dolduğunda kullanıcının oturumu otomatik sona erer.",
        duration: 8000,
      });
      void qc.invalidateQueries({ queryKey: userKey });
      void qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const buildPayload = (): PermissionSetItem[] =>
    selected.map((id) => ({ permissionId: id, validUntil: dates[id] || null }));

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
          dates={dates}
          onDateChange={handleDateChange}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Seçili her iznin altından opsiyonel <span className="font-medium">bitiş tarihi</span>{" "}
        verebilirsiniz (boş = süresiz). Süreli izinde tarih dolduğunda kullanıcının o iznine
        dayanan oturumu otomatik sona erer.
      </p>
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={reset}
        >
          Sıfırla
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate(buildPayload())}
        >
          <Save className="h-4 w-4" /> {mutation.isPending ? "Kaydediliyor..." : "Yetkileri Kaydet"}
        </Button>
      </div>
    </div>
  );
}
