import { useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { foldedIncludes } from "@/lib/search-fold";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import apiClient from "@/services/apiClient";
import {
  adminUserService,
  type AdminUserListItem,
} from "@/services/adminUserService";
import type { ApiResponse } from "@/types/api";
import { UserFormDialog, type UserFormValues } from "./UserFormDialog";
import { UserDetailDialog } from "./UserDetailDialog";
import { NewUserCredentialsDialog } from "./NewUserCredentialsDialog";
import { ShortCredentialsDialog } from "./ShortCredentialsDialog";
import { useAccessUsersTable } from "./userColumns";
import { PendingCredentialResets } from "./PendingCredentialResets";
import { LoginLockoutsButton } from "./LoginLockoutsDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useEnabledLoginMethods } from "@/hooks/usePricingEnabled";

const QUERY_KEY = "admin-users";

// Dışa aktarım sütunları. ⚠️ Kimlik bilgisi (şifre/PIN/kart jetonu) BURAYA ASLA
// girmez — liste ucu zaten döndürmüyor, dosya ise elden ele dolaşır.
const USER_EXPORT_COLUMNS: ExportColumn<AdminUserListItem>[] = [
  { label: "Kullanıcı Adı", value: (u) => u.username },
  { label: "Ad Soyad", value: (u) => u.fullName },
  { label: "Durum", value: (u) => (u.isActive ? "Aktif" : "Pasif") },
  {
    label: "Yetki Sayısı",
    // En yetkili hesapta sayı 0'dır (yetki grant satırı olarak yazılmaz) — dışa
    // aktarımda ham 0 basmak "yetkisiz" yalanı olurdu.
    value: (u) => (u.isSystemAccount ? "Tüm yetkiler" : u._count.permissions),
    summable: true,
  },
  { label: "Oluşturma", value: (u) => safeFormat(u.createdAt, "dd.MM.yyyy HH:mm") },
];

interface UserPayload {
  username?: string;
  fullName?: string;
  password?: string;
  /** Yeni kullanıcıya üretim istasyon izinlerini (KK1/KK2/Tambur) otomatik ver. */
  grantOperatorDefaults?: boolean;
  /** Mobil kimlik (hızlı PIN + QR kart) otomatik üret (oluşturma-sonrası modal gösterir). */
  generateMobileCredentials?: boolean;
}

const userMutations = {
  create: (data: UserPayload) =>
    apiClient.post<ApiResponse<AdminUserListItem>>("/api/admin/users", data).then((r) => r.data),
  /** GEÇİCİ pasife al (geri alınabilir). */
  deactivate: (id: string) =>
    apiClient.post<ApiResponse<AdminUserListItem>>(`/api/admin/users/${id}/deactivate`).then((r) => r.data),
  /** Pasiften aktifleştir. */
  reactivate: (id: string) =>
    apiClient.post<ApiResponse<AdminUserListItem>>(`/api/admin/users/${id}/reactivate`).then((r) => r.data),
  /** KALICI sil (geri alınamaz). */
  remove: (id: string) =>
    apiClient.delete<ApiResponse<AdminUserListItem>>(`/api/admin/users/${id}`).then((r) => r.data),
};

export function AccessUsersPage() {
  const qc = useQueryClient();
  const openTarget = useOpenTarget();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  // `?kisa=1` (Cihazlar → Anahtar kaybı → "Anahtarı geri yükle"): kısa kimlik diyaloğu açık gelir.
  const [searchParams] = useSearchParams();
  const [shortCredOpen, setShortCredOpen] = useState(() => searchParams.get("kisa") === "1");
  const { hasPermission } = useRoleAccess();
  // Uçlarla aynı eşik: admin:settings + admin:users (toplu sıfırlama düz PIN döndürür).
  const canManageShortCredentials = hasPermission("admin:settings") && hasPermission("admin:users");
  const [permissionsFor, setPermissionsFor] = useState<AdminUserListItem | null>(null);
  const [detailTab, setDetailTab] = useState<"permissions" | "quick-pin">("permissions");
  const [deletingUser, setDeletingUser] = useState<AdminUserListItem | null>(null);
  // Pasifleri (isActive=false) listede göster/gizle — varsayılan gizli (temiz liste).
  const [showInactive, setShowInactive] = useState(false);
  // Yeni kullanıcı oluşturulunca açılan "kimlik kartı" (etkin yöntemlerin kimlikleri).
  const [newCreds, setNewCreds] = useState<{ user: AdminUserListItem; password?: string } | null>(null);
  const enabledMethods = useEnabledLoginMethods();

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: adminUserService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  // Backend silinmişleri (deletedAt) zaten gizler. Pasifler yalnız "Pasifleri göster"
  // açıkken görünür (aktifleştirilebilsin); varsayılan yalnız aktifler.
  const filtered = useMemo(() => {
    let list = query.data?.data ?? [];
    if (!showInactive) list = list.filter((u) => u.isActive);
    if (!search) return list;
    // ⚠️ Terime ÖN İŞLEM UYGULAMA: `search.toLowerCase()` Türkçede BOZUKTUR
    // ("ŞAHİN" → "şahi̇n", i + U+0307) ve katlamadan sonra da nokta kalır →
    // büyük İ içeren her arama 0 satır dönerdi. Ham terimi ver.
    const q = search;
    return list.filter(
      (u) => foldedIncludes(u.username, q) || foldedIncludes(u.fullName, q),
    );
  }, [query.data, search, showInactive]);

  const invalidate = () => qc.invalidateQueries({ queryKey: [QUERY_KEY] });

  const createMut = useMutation({
    mutationFn: ({ _password, ...payload }: UserPayload & { _password?: string }) => {
      void _password; // yalnız modal hatırlatması; backend'e gönderilmez
      return userMutations.create(payload);
    },
    onSuccess: (res, vars) => {
      toast.success("Kullanıcı oluşturuldu.");
      invalidate();
      // Kimlik kartı modalı YALNIZ bir mobil yöntem (PIN/kart) etkinken açılır
      // ("ne aktifse onu göster" — salt liste ise gösterilecek QR/PIN yok, toast yeter).
      const created = res.data;
      const hasMobileMethod = enabledMethods.includes("pin") || enabledMethods.includes("card");
      if (created && vars.generateMobileCredentials && hasMobileMethod) {
        setNewCreds({ user: created, password: vars._password });
      }
    },
  });

  const deactivateMut = useMutation({
    mutationFn: userMutations.deactivate,
    onSuccess: () => {
      toast.success("Kullanıcı pasife alındı (geri alınabilir).");
      invalidate();
    },
  });

  const reactivateMut = useMutation({
    mutationFn: userMutations.reactivate,
    onSuccess: () => {
      toast.success("Kullanıcı aktifleştirildi.");
      invalidate();
    },
  });

  const removeMut = useMutation({
    mutationFn: userMutations.remove,
    onSuccess: () => {
      toast.success("Kullanıcı kalıcı olarak silindi.");
      setDeletingUser(null);
      invalidate();
    },
  });

  const table = useAccessUsersTable(filtered, {
    onFootprint: (u, e) => openTarget(`/access/users/${u.id}`, e),
    onManage: (u) => {
      setDetailTab("permissions");
      setPermissionsFor(u);
    },
    onDeactivate: (u) => deactivateMut.mutate(u.id),
    onReactivate: (u) => reactivateMut.mutate(u.id),
    onDelete: setDeletingUser,
    deactivating: deactivateMut.isPending,
    reactivating: reactivateMut.isPending,
  });

  const onSubmit = async (values: UserFormValues) => {
    // isActive ARTIK formdan yönetilmez — aktiflik yalnız Pasife Al / Aktifleştir
    // butonlarından (guard'lı uçlar). Yeni kullanıcı zaten aktif doğar. Varsayılan
    // üretim izinleri (KK1/KK2/Tambur) + mobil kimlik üretimi (backend etkin
    // yöntemlere göre üretir). _password modal'da "Kullanıcı+Şifre" yöntemi
    // etkinse hatırlatılır (geri okunamaz).
    await createMut.mutateAsync({
      username: values.username,
      fullName: values.fullName,
      password: values.password,
      grantOperatorDefaults: values.grantOperatorDefaults,
      generateMobileCredentials: values.grantOperatorDefaults,
      _password: values.password,
    });
    setFormOpen(false);
  };

  return (
    <PageShell>
      <PageHeader
        title="Kullanıcılar"
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            {hasPermission("admin:users") && <LoginLockoutsButton />}
            {canManageShortCredentials && (
              <Button size="sm" variant="outline" onClick={() => setShortCredOpen(true)}>
                <KeyRound className="h-4 w-4" /> Kısa Kimlikler
              </Button>
            )}
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" /> Yeni Kullanıcı
            </Button>
          </>
        }
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara…" title="Kullanıcı adı veya ad soyad ara" aria-label="Kullanıcı adı veya ad soyad ara"
          className="h-8 w-64 text-sm"
        />
        <div className="ml-auto flex items-center gap-1.5">
          {/* Dosya kendi sütunlarıyla iner (kimlik bilgisi asla) — tablo menüsünde ikinci indirme yok. */}
          <DataTableTools table={table} compact hideExport />
          <ListExportMenu
            name="Kullanıcılar"
            rows={filtered}
            columns={USER_EXPORT_COLUMNS}
            notes={[
              showInactive
                ? "Liste pasif kullanıcıları da içerir."
                : "Yalnız AKTİF kullanıcılar — pasifler listede gizli.",
              "Kimlik bilgileri (şifre / PIN / kart) dosyaya yazılmaz.",
            ]}
          />
        </div>
        <label className="flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border bg-background px-3 text-xs">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(c) => setShowInactive(Boolean(c))}
          />
          Pasifleri göster
        </label>
      </ListToolbar>

      {hasPermission("admin:users") && <PendingCredentialResets />}

      {!query.isLoading && filtered.length > 0 ? (
        <DataTable table={table} exportName="Kullanıcılar" rowClassName={(u) => (u.isActive ? undefined : "opacity-60")} />
      ) : (
        <ListBody>
          {query.isLoading ? (
            <ListMessage className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </ListMessage>
          ) : (
            <p className="py-10 text-center text-muted-foreground">Kullanıcı bulunamadı.</p>
          )}
        </ListBody>
      )}

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={onSubmit}
        isSubmitting={createMut.isPending}
      />

      <UserDetailDialog
        user={permissionsFor}
        open={Boolean(permissionsFor)}
        initialTab={detailTab}
        onOpenChange={(open) => {
          if (!open) {
            setPermissionsFor(null);
            setDetailTab("permissions");
          }
        }}
      />

      <ShortCredentialsDialog open={shortCredOpen} onOpenChange={setShortCredOpen} />

      <NewUserCredentialsDialog
        user={newCreds?.user ?? null}
        password={newCreds?.password}
        onOpenChange={(open) => !open && setNewCreds(null)}
        onManage={() => {
          const u = newCreds?.user;
          setNewCreds(null);
          if (u) {
            setDetailTab("quick-pin"); // "yönet" → Hızlı PIN sekmesiyle açılsın
            setPermissionsFor(u);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingUser)}
        onOpenChange={(open) => !open && setDeletingUser(null)}
        title="Kullanıcıyı KALICI olarak sil"
        description={
          deletingUser
            ? `"${deletingUser.fullName}" (${deletingUser.username}) KALICI olarak silinecek — bu işlem GERİ ALINAMAZ. Kayıt yalnız sistem geçmişi / veri bütünlüğü için saklanır; listede görünmez, aktifleştirilemez. Kullanıcı adı serbest kalır (aynı isimle yeni kullanıcı açılabilir). Geçici olarak durdurmak istiyorsanız "Pasife Al"ı kullanın.`
            : undefined
        }
        confirmLabel="Kalıcı olarak sil"
        destructive
        isPending={removeMut.isPending}
        onConfirm={() => {
          if (deletingUser) removeMut.mutate(deletingUser.id);
        }}
      />
    </PageShell>
  );
}
