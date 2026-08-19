import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { ByScreenView } from "./ByScreenView";
import { screenCatalogService } from "@/services/screenCatalogService";
import { permissionCatalogService } from "@/services/permissionCatalogService";
import { adminUserService, type PermissionSetItem } from "@/services/adminUserService";
import { TemplateApplyPanel } from "./TemplateApplyPanel";

interface Props {
  userId: string;
}

const CATALOG_KEY = "permission-catalog";

/**
 * İki pencere, tek gerçek (2026-08-19 — yetki mimarisi Katman 2, adım 2).
 * "Ekrana göre" varsayılan: yöneticinin kafasındaki soru "bu kişi hangi ekranda
 * ne yapsın", "hangi modülün write yetkisi olsun" değil. Modül gridi ince ayar
 * için duruyor. Seçim ORTAK — sekme değiştirmek hiçbir şeyi sıfırlamaz.
 */
type ViewMode = "screen" | "module";

export function PermissionsTab({ userId }: Props) {
  const qc = useQueryClient();
  const userKey = ["admin-user-permissions", userId];

  const [view, setView] = useState<ViewMode>("screen");

  const catalog = useQuery({
    queryKey: [CATALOG_KEY],
    queryFn: permissionCatalogService.list,
    staleTime: 5 * 60 * 1000,
  });

  const screens = useQuery({
    queryKey: ["screen-catalog"],
    queryFn: screenCatalogService.list,
    staleTime: 5 * 60 * 1000,
  });

  const userPerms = useQuery({
    queryKey: userKey,
    queryFn: () => adminUserService.getPermissions(userId),
    refetchOnMount: "always",
    staleTime: 0,
  });

  const grants = userPerms.data?.data ?? [];
  const initialIds = grants.map((g) => g.permissionId);
  // Süreli izinler: permissionId → "YYYY-MM-DD" (bitiş tarihi). validUntil ISO'dan gün
  // kısmını al (UTC gece yarısı damgalandığı için slice drift'siz round-trip eder).
  const initialDates: Record<string, string> = {};
  for (const g of grants) if (g.validUntil) initialDates[g.permissionId] = g.validUntil.slice(0, 10);

  const [selected, setSelected] = useState<string[]>(initialIds);
  const [dates, setDates] = useState<Record<string, string>>(initialDates);

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

  /**
   * KAYDETMEDEN ÖNCE NE DEĞİŞİYOR (2026-08-19). Eskiden yalnız "Kaydet" aktifti;
   * 68 satırlık bir gridde kullanıcının ne eklediğini/çıkardığını hatırlaması
   * bekleniyordu. Yetki kaldırmak sessiz ve geri dönüşü zahmetli bir işlemdir
   * (hedef kullanıcının oturumu düşer) → sayı ekranda durmalı.
   */
  const added = selected.filter((id) => !initialIds.includes(id)).length;
  const removed = initialIds.filter((id) => !selected.includes(id)).length;

  const reset = () => {
    setSelected(initialIds);
    setDates(initialDates);
  };

  const clearAll = () => {
    setSelected([]);
    setDates({});
  };

  const applyTemplate = (permissionIds: string[], mode: "merge" | "replace") => {
    if (mode === "replace") {
      setSelected(permissionIds);
      setDates((prev) => {
        const next: Record<string, string> = {};
        for (const id of permissionIds) if (prev[id]) next[id] = prev[id];
        return next;
      });
      toast.success(`Şablon uygulandı (${permissionIds.length} yetki) — kaydetmeyi unutmayın.`);
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...permissionIds])));
      toast.success("Şablon eklendi — kaydetmeyi unutmayın.");
    }
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
    <div className="flex h-full flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["screen", "Ekrana göre"],
                ["module", "Modüle göre (ince ayar)"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={
                  "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors " +
                  (view === k
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {view === "screen" ? (
              <ByScreenView
                screens={screens.data?.data.screens ?? []}
                permissions={catalog.data?.data ?? []}
                value={selected}
                onChange={setSelected}
                disabled={mutation.isPending}
              />
            ) : (
              <PermissionGrid
                permissions={catalog.data?.data ?? []}
                value={selected}
                onChange={setSelected}
                disabled={mutation.isPending}
                dates={dates}
                onDateChange={handleDateChange}
              />
            )}
          </div>
        </div>
        <TemplateApplyPanel onApply={applyTemplate} disabled={mutation.isPending} />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selected.length === 0 || mutation.isPending}
            onClick={clearAll}
          >
            Sıfırla
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={reset}
          >
            Değişiklikleri Geri Al
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (added > 0 || removed > 0) && (
            <div className="flex items-center gap-2 text-xs">
              {added > 0 && (
                <span className="rounded bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700">
                  +{added} eklenecek
                </span>
              )}
              {/* Kaldırma AYRI ve daha dikkat çekici: eklemek geri alınabilir bir
                  genişletme, kaldırmak ise kullanıcının işini durdurabilir. */}
              {removed > 0 && (
                <span className="rounded bg-destructive/10 px-2 py-1 font-medium text-destructive">
                  −{removed} kaldırılacak
                </span>
              )}
            </div>
          )}
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
    </div>
  );
}
