import { Menu, PanelLeft, Search, LogOut, RotateCw, Settings, Activity } from "lucide-react";
import { PencereKontrolleri } from "./PencereKontrolleri";
import { Button } from "@/components/ui/button";
import { DemoModeBadge } from "@/components/demo/DemoModeBadge";
import { ChannelBadge } from "./ChannelBadge";
import { SupportSessionBadge } from "./SupportSessionBadge";
import { AppearanceMenu } from "./AppearanceMenu";
import { LoomAlarmBell } from "@/pages/Operations/LoomAlarms/LoomAlarmBell";
import { GuncellemeDugmesi } from "./GuncellemeDugmesi";
import { BildirimZili } from "./BildirimZili";
import { MasaustuBildirimKoprusu } from "@/components/bildirim/MasaustuBildirimKoprusu";
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

interface Props {
  onToggleSidebar: () => void;
  /** Dar kabuk (≤1024 px): düğme çekmeceyi açar, arama/ad sıkışır (UX-3). */
  narrow?: boolean;
  drawerOpen?: boolean;
  onOpenCommand: () => void;
}

/** Kullanıcı adından baş harf(ler) — "mehmet.planlama" → "MP", "admin" → "AD". */
function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.split(/[.\s_-]+/).filter(Boolean);
  // ⚠️ `toLocaleUpperCase("tr")`: düz `toUpperCase()` "ışık" → "IS" üretiyordu,
  // doğrusu "İŞ". Baş harf kullanıcının adıdır; yanlış harf yanlış kişiyi
  // gösteriyormuş gibi okunur.
  if (parts.length >= 2) {
    return upperTr((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? ""));
  }
  return upperTr(name.slice(0, 2));
}

export function Topbar({ onToggleSidebar, onOpenCommand, narrow = false, drawerOpen = false }: Props) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isAdmin, permissions, hasAnyPermission } = useRoleAccess();
  // Etkinlik bağlantısı sayfanın kendi ProtectedRoute'uyla AYNI izin kümesinden okunur.
  const canSeeActivity = hasAnyPermission(SYSTEM_ACTIVITY_ACCESS);
  const navigateActive = useTabsStore((s) => s.navigateActive);

  return (
    <header className="app-drag flex h-12 shrink-0 select-none items-center gap-1 border-b border-border/60 bg-card/60 pr-1 backdrop-blur-xl sm:gap-2 sm:pr-3">
      <div className="topbar-leading flex shrink-0 items-center gap-1 pl-1 app-no-drag sm:gap-2 sm:pl-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kenar çubuğu"
          title={narrow ? "Menüyü aç/kapat" : "Kenar çubuğunu aç/kapat"}
          aria-expanded={narrow ? drawerOpen : undefined}
          onClick={onToggleSidebar}
        >
          {narrow ? <Menu className="h-5 w-5" /> : <PanelLeft className="h-4 w-4" />}
        </Button>

        <button
          type="button"
          onClick={onOpenCommand}
          aria-label="Hızlı arama"
          className="flex h-8 w-8 items-center justify-center gap-2 rounded-md border border-border/60 bg-background/40 text-sm md:w-56 md:justify-start md:px-3 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden flex-1 text-left md:inline">Ara veya komut…</span>
          <kbd className="hidden rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium md:inline">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-0.5 app-no-drag sm:gap-1">
        {/* Hazırlık kanalının işareti ("TEST FABRİKA") — üretim kanalında hiçbir şey çizilmez. */}
        <ChannelBadge />
        {/* Destek (süperadmin) oturumunun sürekli işareti — fabrika hesabında çizilmez. */}
        <SupportSessionBadge />
        {/* Unutulmuş demo modu SESSİZ kalamaz — bayrak kapalıyken hiçbir şey çizilmez. */}
        <DemoModeBadge />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sayfayı yeniden yükle"
          title="Sayfayı yeniden yükle (Ctrl+Shift+R)"
          className="hidden sm:inline-flex"
          onClick={() => window.location.reload()}
        >
          <RotateCw className="h-4 w-4" />
        </Button>

        {/* Güncelleme denetleme — ritmi beklemek istemeyen kişi kendisi sorar.
            Durum eşlemesi tek kaynaktan (`@/lib/updater-durum`); web panelinde
            hiç çizilmez. */}
        <GuncellemeDugmesi />

        {/* Tezgah alarmı — Etkinlik akışından AYRI zil; bayrak/izin yoksa hiç çizilmez. */}
        <LoomAlarmBell />

        {/* Kişisel bildirim zili (gelen kutusu) — bayrak kapalı / eski backend → hiç çizilmez. */}
        <BildirimZili />
        {/* Masaüstü OS bildirimi + görev çubuğu rozeti — DOM üretmez; web/bayrak kapalı → IPC yok. */}
        <MasaustuBildirimKoprusu />

        {/* Etkinlik = sayaçsız akış (audit ayak izi): rozet/okunmamış sayısı TAŞIMAZ.
            Kişisel bildirim zili (gelen kutusu) hemen solunda. */}
        {canSeeActivity && (
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
        )}

        <AppearanceMenu />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {initials(user?.username)}
              </span>
              <span className="hidden max-w-[12rem] truncate text-sm md:inline">{user?.username ?? "—"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user?.username}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {isAdmin ? "Admin" : `${permissions.length} yetki`}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigateActive("/settings")}>
              <Settings className="mr-2 h-4 w-4" /> Kullanıcı Tercihleri
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout().then(() => (window.location.hash = "#/login"));
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Çıkış
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Pencere düğmeleri EN SAĞDA — uygulamanın kendi başlığı aynı zamanda
            pencerenin başlığıdır; ayrı bir şerit yok. */}
        <PencereKontrolleri />
      </div>
    </header>
  );
}
