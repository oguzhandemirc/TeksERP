// Ayar sekmesindeki hazırlık rozeti + eksikler (`GET /readiness`) — sunucu ölçer, panel hesap yapmaz.
// Eski backend (404) ya da izinsiz kullanıcıda hiç çizilmez.
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useEIrsaliyePermissions, useEIrsaliyeReadiness } from "./useEIrsaliye";

export function EIrsaliyeReadinessPanel() {
  const { canReadiness } = useEIrsaliyePermissions();
  const q = useEIrsaliyeReadiness(canReadiness);
  if (!canReadiness || q.isError) return null;
  if (!q.data) return <Skeleton className="h-10 w-full" />;
  const ready = q.data.durum === "HAZIR";
  return (
    <div className="space-y-1.5 rounded-md border p-3" data-testid="eirsaliye-readiness">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Hazırlık durumu</span>
        {ready ? (
          <Badge className="gap-1 border-transparent bg-success/15 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Hazır
          </Badge>
        ) : (
          <Badge className="gap-1 border-transparent bg-warning/15 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Eksik ({q.data.eksikler.length})
          </Badge>
        )}
      </div>
      {ready ? (
        <p className="text-xs text-muted-foreground">Sevkiyat detayında e-İrsaliye hazırlanabilir.</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {q.data.eksikler.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
