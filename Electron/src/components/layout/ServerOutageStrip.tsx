import { Loader2, ServerCog } from "lucide-react";
import { useServerStatusStore } from "@/store/serverStatus";
import { useOutageClock, useOutageTarget } from "@/hooks/useServerOutage";
import { outageStrip } from "@/lib/sunucu-kesintisi";

/**
 * Sunucu güncellemesi şeridi: kurulumdan 5 dk önce "kaydedin" uyarısı, kesintide "yeniden bağlanıyor".
 * Modal değil — yazılan form ekranda kalır; kesintide istekler bağlantı gelene dek bekletilir (`apiClient`).
 */
export function ServerOutageStrip() {
  const target = useOutageTarget();
  const now = useOutageClock(target);
  const offline = useServerStatusStore((s) => s.status === "offline");
  const strip = outageStrip(target, now, offline);
  if (!strip) return null;
  const outage = strip.kind === "outage";
  return (
    <div
      role="status"
      data-testid="sunucu-kesinti-seridi"
      className={
        outage
          ? "flex items-center gap-3 border-b border-info/30 bg-info-soft px-4 py-2 text-sm text-info-soft-foreground"
          : "flex items-center gap-3 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground"
      }
    >
      {outage ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-info-soft-foreground" />
      ) : (
        <ServerCog className="h-4 w-4 shrink-0 text-warning-soft-foreground" />
      )}
      <span className="min-w-0 flex-1">{strip.text}</span>
    </div>
  );
}
