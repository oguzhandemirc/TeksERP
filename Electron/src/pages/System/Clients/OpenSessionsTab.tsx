// Açık oturumlar sekmesi — `sessions` tablosundan (sunucu yeniden başlasa da kaybolmaz).
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useListSearch } from "@/hooks/useListSearch";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { clientStamp } from "./clientsColumns";
import { useOpenSessionsTable } from "./openSessionsColumns";
import { fetchOpenSessions, revokeOpenSession, type OpenSession } from "./sessions-service";
import { sessionDeviceTitle, sessionTypeLabel, versionStrip } from "./sessions-utils";

export const OPEN_SESSIONS_KEY = "open-sessions";
const NO_SESSIONS: OpenSession[] = [];

function VersionStrip({ sessions }: { sessions: OpenSession[] }) {
  const items = versionStrip(sessions);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="Sürüm dağılımı">
      {items.map((i) => (
        <span key={`${i.deviceType}|${i.version ?? ""}`} className={cn(i.outdated ? "text-warning" : "text-muted-foreground")}>
          {sessionTypeLabel(i.deviceType)} <b className="tabular-nums">{i.version ?? "ölçülemedi"}</b> · {i.count}
        </span>
      ))}
    </div>
  );
}

export function OpenSessionsTab() {
  const { search, setSearch, term } = useListSearch();
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canRevoke = hasPermission("admin:users");
  const q = useQuery({
    queryKey: [OPEN_SESSIONS_KEY, term ?? ""],
    queryFn: () => fetchOpenSessions(term),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [target, setTarget] = useState<OpenSession | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => revokeOpenSession(id),
    onSuccess: () => {
      toast.success("Oturum sonlandırıldı");
      setTarget(null);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [OPEN_SESSIONS_KEY] }),
  });
  const onRevoke = useCallback((s: OpenSession) => setTarget(s), []);
  const snap = q.data;
  const sessions = snap?.sessions ?? NO_SESSIONS;
  const table = useOpenSessionsTable(sessions, { now: snap?.now ?? "", onRevoke: canRevoke ? onRevoke : null });

  return (
    <>
      <ListToolbar className="flex-row items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Kullanıcı, cihaz adı, tür ya da sürüm ara" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Açık oturumlar" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        exportName="Açık oturumlar"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Sunucuya ulaşılamıyor — liste alınamadı."
        onRetry={() => void q.refetch()}
        emptyText={term ? "Aramaya uyan oturum yok" : "Açık oturum yok"}
        emptyDescription="Süresi dolan ya da çıkış yapılan oturumlar burada görünmez."
      />
      <ListFooter
        loaded={sessions.length}
        // Kırpma uyarısı kaybolmasın: sayı satırında söylenir.
        label={snap?.truncated ? `İlk ${snap.limit} oturum gösteriliyor — daha fazlası var, aramayla daraltın` : undefined}
        summary={sessions.length > 0 ? <VersionStrip sessions={sessions} /> : undefined}
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Oturum sonlandırılsın mı?"
        description={
          target
            ? [target.user.fullName ?? target.user.username, sessionTypeLabel(target.deviceType), sessionDeviceTitle(target)]
                .filter((p) => p !== "—")
                .join(" · ") +
              "\n" +
              `Sürüm ${target.clientVersion ?? "ölçülemedi"} · açılış ${clientStamp(target.createdAt)}\n\n` +
              "Bu cihaz bir sonraki isteğinde girişe döner; kaydedilmemiş form verisi kaybolabilir. Kişi yeniden giriş yapabilir. İşlem Sistem Kayıtları'na yazılır."
            : undefined
        }
        confirmLabel="Sonlandır"
        destructive
        isPending={revoke.isPending}
        onConfirm={() => (target ? revoke.mutateAsync(target.id).then(() => undefined) : undefined)}
      />
    </>
  );
}
