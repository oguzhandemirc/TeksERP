import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { systemLogService } from "@/services/systemLogService";
import { actionLabel, tableLabel } from "@/pages/System/Activity/labels";
import { useRoleAccess } from "@/hooks/useRoleAccess";

const SEEN_KEY = "notifications.lastSeen";
const LIMIT = 12;

/**
 * Topbar bildirim zili — son DOMAIN aktivitesini (kim neyi değiştirdi) gösterir.
 * 60sn'de bir tazelenir. Görülmemiş sayısı localStorage'daki son-görülme zamanına
 * göre. Endpoint admin:settings gerektirdiğinden yalnız bu yetki (ya da admin
 * wildcard) olanlara render edilir — aksi halde 60sn'de bir 403 toast'u olurdu.
 */
export function NotificationBell() {
  const { permissions } = useRoleAccess();
  const navigate = useNavigate();
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(SEEN_KEY) ?? "");

  const canSee =
    permissions.includes("*") ||
    permissions.includes("admin:*") ||
    permissions.includes("admin:settings");

  const { data } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => systemLogService.list({ category: "DOMAIN", limit: LIMIT }),
    enabled: canSee,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const items = data?.data ?? [];
  const unseen = lastSeen ? items.filter((i) => i.createdAt > lastSeen).length : items.length;

  const handleOpenChange = (open: boolean) => {
    if (open) {
      const latest = items[0]?.createdAt;
      if (latest) {
        localStorage.setItem(SEEN_KEY, latest);
        setLastSeen(latest);
      }
    }
  };

  if (!canSee) return null;

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Bildirimler" title="Son aktivite">
          <Bell className="h-4 w-4" />
          {unseen > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Son Aktivite</p>
          <span className="live-dot" title="Canlı" />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Kayıt yok.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((it) => {
                const fresh = lastSeen ? it.createdAt > lastSeen : true;
                return (
                  <li key={it.id} className={cn("px-3 py-2 text-xs", fresh && "bg-primary/5")}>
                    <p className="text-foreground">
                      <span className="font-medium">{it.user?.fullName ?? "Sistem"}</span>{" "}
                      <span className="text-muted-foreground">{actionLabel(it.action)}</span>{" "}
                      <span className="font-medium">{tableLabel(it.tableName)}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDistanceToNow(new Date(it.createdAt), { addSuffix: true, locale: tr })}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate("/system/activity")}
          className="block w-full border-t px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Tüm aktiviteyi gör
        </button>
      </PopoverContent>
    </Popover>
  );
}
