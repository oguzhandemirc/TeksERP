import { PanelLeft, Search, LogOut, RotateCw, Settings } from "lucide-react";
import { PencereKontrolleri } from "./PencereKontrolleri";
import { Button } from "@/components/ui/button";
import { DemoModeBadge } from "@/components/demo/DemoModeBadge";
import { AppearanceMenu } from "./AppearanceMenu";
import { NotificationBell } from "./NotificationBell";
import { GuncellemeDugmesi } from "./GuncellemeDugmesi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { upperTr } from "../../lib/tr-case";

interface Props {
  onToggleSidebar: () => void;
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

export function Topbar({ onToggleSidebar, onOpenCommand }: Props) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isAdmin, permissions } = useRoleAccess();
  const navigateActive = useTabsStore((s) => s.navigateActive);

  return (
    <header className="app-drag flex h-12 shrink-0 select-none items-center gap-2 border-b border-border/60 bg-card/60 pr-3 backdrop-blur-xl">
      <div className="topbar-leading flex items-center gap-2 pl-2 app-no-drag">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kenar çubuğu"
          title="Kenar çubuğunu aç/kapat"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <button
          type="button"
          onClick={onOpenCommand}
          aria-label="Hızlı arama"
          className="flex h-8 w-56 items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left">Ara veya komut…</span>
          <kbd className="rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1 app-no-drag">
        {/* Unutulmuş demo modu SESSİZ kalamaz — bayrak kapalıyken hiçbir şey çizilmez. */}
        <DemoModeBadge />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sayfayı yeniden yükle"
          title="Sayfayı yeniden yükle (Ctrl+Shift+R)"
          onClick={() => window.location.reload()}
        >
          <RotateCw className="h-4 w-4" />
        </Button>

        {/* Güncelleme denetleme — ritmi beklemek istemeyen kişi kendisi sorar.
            Durum eşlemesi tek kaynaktan (`@/lib/updater-durum`); web panelinde
            hiç çizilmez. */}
        <GuncellemeDugmesi />

        <NotificationBell />

        <AppearanceMenu />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {initials(user?.username)}
              </span>
              <span className="text-sm">{user?.username ?? "—"}</span>
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
