import { Menu, PanelLeft, RotateCw } from "lucide-react";
import { PencereKontrolleri } from "./PencereKontrolleri";
import { Button } from "@/components/ui/button";
import { DemoModeBadge } from "@/components/demo/DemoModeBadge";
import { ChannelBadge } from "./ChannelBadge";
import { SupportSessionBadge } from "./SupportSessionBadge";
import { AppearanceMenu } from "./AppearanceMenu";
import { ThemeToggle } from "./ThemeToggle";
import { shellHeadingFor } from "./shell-heading";
import { TopbarActivityButton, TopbarSearch, TopbarUserMenu } from "./topbar-parts";
import { LoomAlarmBell } from "@/pages/Operations/LoomAlarms/LoomAlarmBell";
import { GuncellemeDugmesi } from "./GuncellemeDugmesi";
import { BildirimZili } from "./BildirimZili";
import { MasaustuBildirimKoprusu } from "@/components/bildirim/MasaustuBildirimKoprusu";
import { useTabsStore } from "@/store/tabs";

interface Props {
  onToggleSidebar: () => void;
  /** Dar kabuk (≤1024 px): düğme çekmeceyi açar, arama/ad sıkışır (UX-3). */
  narrow?: boolean;
  drawerOpen?: boolean;
  onOpenCommand: () => void;
}

export function Topbar({ onToggleSidebar, onOpenCommand, narrow = false, drawerOpen = false }: Props) {
  const activePath = useTabsStore((s) => s.tabs?.find((t) => t.id === s.activeId)?.path);
  const heading = shellHeadingFor(activePath);

  return (
    <header className="app-drag flex h-16 shrink-0 select-none items-center gap-2 bg-background pr-1 sm:gap-3 sm:pr-3">
      {/* Dar kabukta (menü çekmece) mac trafik ışıkları bu çubuğun solundadır → `topbar-leading` boşluğu. */}
      <div className={`${narrow ? "topbar-leading " : ""}flex shrink-0 items-center pl-2 app-no-drag sm:pl-3`}>
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
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold leading-tight tracking-tight">{heading.title}</div>
        {heading.description ? (
          <p className="hidden truncate text-xs text-muted-foreground md:block">{heading.description}</p>
        ) : null}
      </div>

      <TopbarSearch onOpenCommand={onOpenCommand} />

      {/* `topbar-tools > button` simge düğmeleri kutulanır (index.css) — çocuk bileşenlere dokunmadan. */}
      <div className="topbar-tools flex min-w-0 shrink-0 items-center gap-1.5 app-no-drag">
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

        {/* Güncelleme denetleme — durum eşlemesi tek kaynaktan (`@/lib/updater-durum`); web panelinde hiç çizilmez. */}
        <GuncellemeDugmesi />

        {/* Tezgah alarmı — Etkinlik akışından AYRI zil; bayrak/izin yoksa hiç çizilmez. */}
        <LoomAlarmBell />

        {/* Kişisel bildirim zili (gelen kutusu) — bayrak kapalı / eski backend → hiç çizilmez. */}
        <BildirimZili />
        {/* Masaüstü OS bildirimi + görev çubuğu rozeti — DOM üretmez; web/bayrak kapalı → IPC yok. */}
        <MasaustuBildirimKoprusu />

        <TopbarActivityButton />

        <ThemeToggle />
        <AppearanceMenu />

        <TopbarUserMenu />
        {/* Pencere düğmeleri EN SAĞDA — uygulamanın kendi başlığı aynı zamanda pencerenin başlığıdır. */}
        <PencereKontrolleri />
      </div>
    </header>
  );
}
