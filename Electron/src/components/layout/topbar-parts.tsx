import { Activity, ChevronDown, LogOut, Search, Settings } from "lucide-react";
import { requestLogout } from "@/components/layout/tabs/dirty-close-guard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SYSTEM_ACTIVITY_ACCESS } from "@/lib/permissions";
import { upperTr } from "../../lib/tr-case";

/** Kullanıcı adından baş harf(ler) — "mehmet.planlama" → "MP", "admin" → "AD". */
function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  // ⚠️ `toLocaleUpperCase("tr")`: düz `toUpperCase()` "ışık" → "IS" üretiyordu, doğrusu "İŞ".
  if (parts.length >= 2) {
    return upperTr((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? ""));
  }
  return upperTr(name.slice(0, 2));
}

/** Arama kutusu görünümlü düğme — komut paletini açar (Ctrl+K kısayolu `useGlobalShortcuts`ta). */
export function TopbarSearch({ onOpenCommand }: { onOpenCommand: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenCommand}
      aria-label="Hızlı arama"
      title="Ekran, kayıt ya da komut ara (Ctrl K)"
      className="app-no-drag flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-card-border bg-card text-sm text-muted-foreground shadow-soft transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-64 md:justify-start md:px-3 lg:w-80 xl:w-96"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="hidden flex-1 truncate text-left md:inline">Ara…</span>
      <kbd className="hidden rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold md:inline">
        Ctrl K
      </kbd>
    </button>
  );
}

/** Etkinlik = sayaçsız akış (audit ayak izi): rozet/okunmamış sayısı TAŞIMAZ. İzin, sayfanın route kümesi. */
export function TopbarActivityButton() {
  const { hasAnyPermission } = useRoleAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  if (!hasAnyPermission(SYSTEM_ACTIVITY_ACCESS)) return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Etkinlik"
            onClick={() => navigateActive("/system/activity")}
          >
            <Activity className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Etkinlik</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Kullanıcı: baş harf + ad + rol; menüde tercihler ve çıkış. */
export function TopbarUserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isAdmin, permissions } = useRoleAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const roleText = isAdmin ? "Yönetici" : `${permissions.length} yetki`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-plain
          className="ml-1 flex h-10 items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="nav-active-fill flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 ring-card">
            {initials(user?.username)}
          </span>
          <span className="hidden min-w-0 flex-col leading-tight lg:flex">
            <span className="max-w-[10rem] truncate text-sm font-semibold">{user?.username ?? "—"}</span>
            <span className="truncate text-[11px] text-muted-foreground">{roleText}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted-foreground lg:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{user?.username}</span>
            <span className="text-xs font-normal text-muted-foreground">{roleText}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigateActive("/settings")}>
          <Settings className="mr-2 h-4 w-4" /> Kullanıcı Tercihleri
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            requestLogout(() => void logout().then(() => (window.location.hash = "#/login")));
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Çıkış
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
