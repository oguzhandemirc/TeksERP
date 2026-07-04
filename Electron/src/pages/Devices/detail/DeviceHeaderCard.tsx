import { Clock, LogIn, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat } from "@/lib/format";
import { placeLabel } from "@/pages/System/WorkSessions/types";
import type { DeviceDetail } from "../types";

const KIND_LABEL: Record<string, string> = { TABLET: "Tablet", PHONE: "Telefon", DESKTOP: "PC" };

/**
 * Cihaz detay başlığı: kimlik/durum + son oturum açma (WorkSession.startedAt) +
 * son aktivite (Device.lastSeenAt) + bağlı donanımın etiket profili.
 */
export function DeviceHeaderCard({ device }: { device: DeviceDetail }) {
  const fmt = (v: string | null) => (v ? safeFormat(v, "dd.MM.yyyy HH:mm") : "—");
  const last = device.lastSession;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{device.name}</span>
          <Badge variant="outline">{KIND_LABEL[device.kind] ?? device.kind}</Badge>
          {!device.isActive ? (
            <Badge variant="muted">Pasif</Badge>
          ) : device.status === "APPROVED" ? (
            <Badge>Onaylı</Badge>
          ) : (
            <Badge variant="muted">Onay bekliyor</Badge>
          )}
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {device.deviceId}
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
                  {last.user.fullName} · {placeLabel(last)}
                  {!last.endedAt && " · açık"}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">oturum yok</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">Son aktivite:</span>
            <span>{fmt(device.lastSeenAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Printer className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Donanım / etiket profili:</span>
          {device.hardware.length === 0 ? (
            <span className="text-muted-foreground">bağlı donanım yok</span>
          ) : (
            device.hardware.map((h) => (
              <Badge key={h.id} variant="outline" className="font-normal">
                {h.name}
                <span className="ml-1 text-muted-foreground">
                  → {h.formatProfile?.name ?? "Sistem varsayılanı"}
                  {h.languageOverride ? ` · ${h.languageOverride}` : ""}
                </span>
              </Badge>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
