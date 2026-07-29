import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { useTabsStore } from "@/store/tabs";
import { adminUserService } from "@/services/adminUserService";
import { SessionHistoryList } from "@/pages/System/WorkSessions/SessionHistoryList";
import { UserFootprintHeaderCard } from "./UserFootprintHeaderCard";

/**
 * Kullanıcı Ayak İzi — Yetkilendirme → Kullanıcılar'da bir kullanıcıya tıklayınca açılır.
 * Cihaz İşlem Dökümü'nün analoğu: kullanıcının oturumları (farklı cihazlarda olabilir) +
 * her oturum penceresinde yapılan işlemlerin dökümü. Backend'de yeni endpoint gerekmez —
 * work-sessions history({userId}) + activity paylaşılır.
 */
export function UserFootprintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const detail = useQuery({
    queryKey: ["admin-users", "detail", id],
    queryFn: () => adminUserService.getById(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const user = detail.data?.data ?? null;

  useEffect(() => {
    if (!user?.fullName || !id) return;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/access/users/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, `Ayak İzi · ${user.fullName}`);
  }, [user?.fullName, id]);

  return (
    <PageShell>
      <PageHeader
        title={user ? `${user.fullName} — Ayak İzi` : "Kullanıcı Ayak İzi"}
        onBack={() => navigate("/access/users")}
        actions={
          <RefreshButton
            queryKey={["admin-users", "detail", id ?? ""]}
            extraKeys={[["work-sessions", "history"], ["work-sessions", "activity"]]}
          />
        }
      />

      <PageBody className="space-y-4 p-6">
        {detail.isLoading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        ) : !user ? (
          <p className="rounded-md border py-12 text-center text-sm text-muted-foreground">
            Kullanıcı bulunamadı.
          </p>
        ) : (
          <>
            <UserFootprintHeaderCard user={user} />
            <SessionHistoryList filter={{ userId: user.id }} variant="user" />
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
