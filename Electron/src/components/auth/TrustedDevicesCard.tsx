// Hatırlanan cihazlar kartı (2026-11-01): web girişinde "Bu cihazı N gün hatırla" ile kod sorulmayan
// tarayıcılar. Kendi hesabı (Kullanıcı Tercihleri) ve yönetici (kullanıcı → 2FA sekmesi) aynı kartı kullanır;
// yalnız veri kaynağı değişir. Eski backend (404) ya da ayar kapalı + kayıt yok → kart çizilmez.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MonitorSmartphone, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { formatFactory } from "@/lib/factory-time";
import type { TrustedDeviceList, TrustedDeviceView } from "@/services/authService";

export interface TrustedDevicesCardProps {
  /** Sorgu anahtarı ayrımı (kendi / kullanıcı id). */
  scopeKey: string;
  load: () => Promise<{ data: TrustedDeviceList }>;
  revoke: (deviceId: string) => Promise<void>;
  revokeAll: () => Promise<void>;
  /** Yönetici görünümünde başlık açıklaması kullanıcı adını taşır. */
  subjectLabel?: string;
}

const STATE_LABEL: Record<TrustedDeviceView["state"], string> = {
  GECERLI: "Geçerli",
  SURESI_DOLDU: "Süresi doldu",
  IPTAL: "Kaldırıldı",
  GECERSIZ: "Geçersiz (parola/yetki değişti)",
};

export function TrustedDevicesCard({ scopeKey, load, revoke, revokeAll, subjectLabel }: TrustedDevicesCardProps) {
  const qc = useQueryClient();
  const queryKey = ["trusted-devices", scopeKey];
  const q = useQuery({ queryKey, queryFn: load, retry: false });
  const [target, setTarget] = useState<TrustedDeviceView | "ALL" | null>(null);
  const done = (msg: string) => {
    setTarget(null);
    toast.success(msg);
    void qc.invalidateQueries({ queryKey });
  };
  const one = useMutation({ mutationFn: (id: string) => revoke(id), onSuccess: () => done("Cihaz kaldırıldı.") });
  const all = useMutation({ mutationFn: () => revokeAll(), onSuccess: () => done("Hatırlanan cihazlar kaldırıldı.") });

  const data = q.data?.data;
  if (!data) return null;
  if (data.days === 0 && data.devices.length === 0) return null;
  const active = data.devices.filter((d) => d.state === "GECERLI");

  return (
    <Card data-testid="hatirlanan-cihazlar-karti">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorSmartphone className="h-4 w-4" />
          Hatırlanan cihazlar
        </CardTitle>
        <CardDescription>
          {subjectLabel ? `${subjectLabel} için ` : ""}internetten girişte doğrulama kodu sorulmayan tarayıcılar.
          {data.days > 0 ? ` Süre: ${data.days} gün.` : " Bu kurulumda cihaz hatırlama kapalı."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <DeviceList devices={data.devices} onRevoke={setTarget} />
        {active.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setTarget("ALL")}>
            Hepsini kaldır
          </Button>
        )}
      </CardContent>
      <RevokeConfirm
        target={target}
        active={active}
        pending={one.isPending || all.isPending}
        onClose={() => setTarget(null)}
        onConfirm={() => (target === "ALL" ? all.mutate() : target ? one.mutate(target.id) : undefined)}
      />
    </Card>
  );
}

function DeviceList({ devices, onRevoke }: { devices: TrustedDeviceView[]; onRevoke: (d: TrustedDeviceView) => void }) {
  return (
    devices.length === 0 ? (
      <p className="text-sm text-muted-foreground">Hatırlanan cihaz yok.</p>
    ) : (
      <ul className="divide-y rounded-md border">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 p-2 text-sm" data-testid="hatirlanan-cihaz">
            <div className="min-w-0">
              <div className="font-medium">{d.label}</div>
              <div className="text-xs text-muted-foreground">
                {STATE_LABEL[d.state]} · son kullanım {formatFactory(d.lastUsedAt, "dd.MM.yyyy HH:mm")} · bitiş{" "}
                {formatFactory(d.expiresAt, "dd.MM.yyyy")}
                {d.firstIp ? ` · ${d.firstIp}` : ""}
              </div>
            </div>
            {d.state === "GECERLI" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${d.label} cihazını kaldır`}
                onClick={() => onRevoke(d)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    )
  );
}

function RevokeConfirm({ target, active, pending, onClose, onConfirm }: {
  target: TrustedDeviceView | "ALL" | null;
  active: TrustedDeviceView[];
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={target === "ALL" ? "Bütün hatırlanan cihazlar kaldırılsın mı?" : "Cihaz kaldırılsın mı?"}
      description={
        target === "ALL"
          ? `Kaldırılacak cihazlar: ${active.map((d) => d.label).join(", ")}. Bu tarayıcılardan sonraki girişte doğrulama kodu sorulur.`
          : `${target ? target.label : ""} — bu tarayıcıdan sonraki girişte doğrulama kodu sorulur.`
      }
      confirmLabel="Kaldır"
      cancelLabel="Vazgeç"
      destructive
      isPending={pending}
      onConfirm={onConfirm}
    />
  );
}
