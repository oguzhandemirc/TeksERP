import { Clock, LogIn, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";
import { placeLabel } from "@/pages/System/WorkSessions/types";
import type { AdminUserDetail } from "@/services/adminUserService";

/**
 * Kullanıcı ayak izi başlığı: kimlik/durum + yetki sayısı + son oturum açma
 * (WorkSession.startedAt — hangi cihaz, nerede). Cihaz başlığının (DeviceHeaderCard) analoğu.
 */
export function UserFootprintHeaderCard({ user }: { user: AdminUserDetail }) {
  const last = user.lastSession;
  const fmt = (v: string | null) => (v ? safeFormat(v, "dd.MM.yyyy HH:mm") : "—");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{user.fullName}</span>
          <span className="font-mono text-xs text-muted-foreground">{user.username}</span>
          {user.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            {user.isSystemAccount ? "Tüm yetkiler" : `${user._count.permissions} yetki`}
          </span>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <LogIn className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Son oturum açma:</span>
            {last ? (
              <span>
                {fmt(last.startedAt)}
                <span className="ml-1 text-xs text-muted-foreground">
                  {last.device.name} · {placeLabel(last)}
                  {!last.endedAt && " · açık"}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">oturum yok</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Kayıt tarihi:</span>
            <span>{safeFormat(user.createdAt, "dd.MM.yyyy")}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
