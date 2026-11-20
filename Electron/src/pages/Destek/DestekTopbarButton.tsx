import { LifeBuoy, MessageSquareWarning, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTabsStore } from "@/store/tabs";
import { useDestekStore } from "./destek-store";
import { badgeText } from "./unread";
import { startReport } from "./useDestekShell";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
export const REPORT_SHORTCUT_LABEL = IS_MAC ? "⌘⇧B" : "Ctrl+Shift+B";

/** Üst çubuktaki Destek girişi. Özellik kapalıyken HİÇ çizilmez. */
export function DestekTopbarButton() {
  const enabled = useDestekStore((s) => s.enabled);
  const unread = useDestekStore((s) => s.unreadMine);
  const unreadTenant = useDestekStore((s) => s.unreadTenant);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  if (!enabled) return null;
  const badge = badgeText(unread);
  // Firmanın kapsamı kişinin kendi taleplerini de içerir: toplamak çift sayardı.
  const total = Math.max(unread ?? 0, unreadTenant ?? 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={badge ? `Destek, ${unread} yanıtlanmış talep` : "Destek"}
          title="Destek"
        >
          <LifeBuoy className="h-4 w-4" />
          {badge && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Destek</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void startReport()}>
          <MessageSquareWarning className="mr-2 h-4 w-4" /> Sorun bildir
          <span className="ml-auto text-[10px] tracking-wide text-muted-foreground">{REPORT_SHORTCUT_LABEL}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigateActive("/destek")}>
          <Inbox className="mr-2 h-4 w-4" /> Destek talepleri
          {total > 0 && (
            <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
              {total > 9 ? "9+" : total}
            </span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
