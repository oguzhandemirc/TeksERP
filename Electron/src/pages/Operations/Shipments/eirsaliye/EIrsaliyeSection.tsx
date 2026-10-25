// Sevkiyat detayındaki e-İrsaliye bölümü (panel + tam sayfa AYNI bileşen). Okuma izni
// yoksa ya da sunucu hazırlık ucunu tanımıyorsa (eski backend 404) hiç çizilmez; yapılandırma
// eksikse bölüm GÖRÜNÜR kalır ve ayar ekranının yolunu söyler (bulunabilirlik şartı).
import { Link } from "react-router-dom";
import { FileCheck2, Settings2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EIrsaliyeCard } from "./EIrsaliyeCard";
import { eIrsaliyeSettingsLink, useEIrsaliyePermissions, useEIrsaliyeReadiness } from "./useEIrsaliye";
import type { EIrsaliyeReadiness } from "./types";

export function EIrsaliyeSection({ shipmentId, shipmentStatus }: { shipmentId: string; shipmentStatus: string }) {
  const perms = useEIrsaliyePermissions();
  const readiness = useEIrsaliyeReadiness(perms.canRead);
  if (!perms.canRead || readiness.isError) return null;
  if (readiness.isLoading || !readiness.data) return <Skeleton className="h-16 w-full" />;
  if (readiness.data.durum !== "HAZIR") return <EIrsaliyeUnconfigured readiness={readiness.data} />;
  return <EIrsaliyeCard shipmentId={shipmentId} shipmentStatus={shipmentStatus} perms={perms} />;
}

export function EIrsaliyeTitle() {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <FileCheck2 className="h-3.5 w-3.5" /> e-İrsaliye
    </span>
  );
}

/** Yapılandırılmamış kurulum: tek satır + ayar bağlantısı; eksikler açılır listede. */
export function EIrsaliyeUnconfigured({ readiness }: { readiness: EIrsaliyeReadiness }) {
  const link = eIrsaliyeSettingsLink();
  return (
    <Card data-testid="eirsaliye-unconfigured">
      <CardContent className="space-y-1.5 p-3 text-sm">
        <EIrsaliyeTitle />
        <p className="text-muted-foreground">
          Yapılandırılmamış —{" "}
          <Link to={link.path} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <Settings2 className="h-3.5 w-3.5" /> {link.trail}
          </Link>
        </p>
        {readiness.eksikler.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Eksikler ({readiness.eksikler.length})</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {readiness.eksikler.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
