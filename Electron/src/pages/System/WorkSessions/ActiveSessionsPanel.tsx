import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, MonitorSmartphone, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { safeFormat } from "@/lib/format";
import { workSessionService } from "./service";
import {
  formatDurationMinutes,
  placeLabel,
  sessionDurationMinutes,
  type WorkSessionItem,
} from "./types";

export const ACTIVE_SESSIONS_QUERY_KEY = ["work-sessions", "active"] as const;
const REFRESH_MS = 10_000;

/**
 * Canlı panel — kim hangi makinede/istasyonda. 10 sn'de bir poll'lanır ama YALNIZ
 * sekme aktifken (useIsTabActive — pasif sekme mount kalır, arka planda süresiz
 * polling'e dönüşmesin; serverHealth K-A8 deseni). Zorla kapatma yıkıcı işlem:
 * ConfirmDialog etkilenen oturumu somut listeler + operatörün yeniden yer onayı
 * vereceğini söyler.
 */
export function ActiveSessionsPanel() {
  const qc = useQueryClient();
  const isTabActive = useIsTabActive();
  const { hasPermission } = useRoleAccess();
  const canManage = hasPermission("admin:settings");
  const [closeTarget, setCloseTarget] = useState<WorkSessionItem | null>(null);

  const q = useQuery({
    queryKey: ACTIVE_SESSIONS_QUERY_KEY,
    queryFn: workSessionService.listActive,
    refetchInterval: isTabActive ? REFRESH_MS : false,
    refetchOnWindowFocus: true,
  });
  const sessions = q.data?.data ?? [];

  const forceClose = useMutation({
    mutationFn: workSessionService.forceClose,
    onSuccess: () => {
      toast.success("Oturum kapatıldı — operatör bir sonraki işlemde yeniden yer onayı verecek");
      setCloseTarget(null);
      void qc.invalidateQueries({ queryKey: ACTIVE_SESSIONS_QUERY_KEY });
    },
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mx-auto max-w-md py-12 text-center text-sm text-muted-foreground">
        Şu an açık çalışma oturumu yok. Sahada bir operatör makine/istasyon onayı
        verdiğinde burada canlı görünür.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => (
        <Card key={s.id}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.user.fullName}</span>
                <Badge variant="outline" className="gap-1">
                  <MapPin className="h-3 w-3" /> {placeLabel(s)}
                </Badge>
                {s.machine && <span className="font-mono text-xs text-muted-foreground">{s.machine.code}</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MonitorSmartphone className="h-3 w-3" /> {s.device.name}
                </span>
                <span>
                  Başlangıç: {safeFormat(s.startedAt, "dd.MM HH:mm")} (
                  {formatDurationMinutes(sessionDurationMinutes(s.startedAt, null))})
                </span>
                <span>Son aktivite: {safeFormat(s.lastActivityAt, "HH:mm:ss")}</span>
              </div>
            </div>
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setCloseTarget(s)}
              >
                <XCircle className="h-4 w-4" /> Zorla Kapat
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={!!closeTarget}
        onOpenChange={(open) => {
          if (!open) setCloseTarget(null);
        }}
        title="Oturumu zorla kapat"
        description={
          closeTarget
            ? `${closeTarget.user.fullName} — ${placeLabel(closeTarget)} (${closeTarget.device.name}) oturumu kapatılacak. Operatörün elindeki işlem kesilmez; bir SONRAKİ kayıt denemesinde cihaz yeniden yer onayı ister. Kayıtlı üretim izleri silinmez.`
            : undefined
        }
        confirmLabel="Zorla kapat"
        destructive
        isPending={forceClose.isPending}
        onConfirm={() => {
          if (closeTarget) forceClose.mutate(closeTarget.id);
        }}
      />
    </div>
  );
}
