import { useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { ShellBanners } from "./ShellBanners";
import { TabHost } from "./tabs";
import { SurumNotlariDialog } from "./SurumNotlariDialog";
import { useSurumNotuAcilis } from "@/hooks/useSurumNotuAcilis";
import { useGirisGuncellemeKontrolu } from "@/hooks/useGirisGuncellemeKontrolu";
import { ScanResultOverlay } from "@/components/scanner/ScanResultOverlay";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useServerHeartbeat } from "@/hooks/useServerClock";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useExpiryAutoLogout } from "@/hooks/useExpiryAutoLogout";
import { useLicenseRelay } from "@/hooks/useLicenseRelay";
import { usePdfLicenseWatermark } from "@/hooks/usePdfLicenseWatermark";
import { useScannerWedge } from "@/hooks/useScannerWedge";
import { useDeviceScanner } from "@/hooks/useDeviceScanner";
import { useDeviceAnnounce } from "@/hooks/useDeviceAnnounce";
import { useScannerStore } from "@/store/scanner";
import { useMachineConfig } from "@/hooks/useMachineConfig";
import { useHashPath } from "@/lib/use-hash-path";
import { TEZGAH_TV_PATH } from "@/pages/Operations/WeavingFloor/tv-entry";
import { WeavingFloorTvScreen } from "@/pages/Operations/WeavingFloor/WeavingFloorTvScreen";
import { useTvRestore } from "@/pages/Operations/WeavingFloor/useTvRestore";

/**
 * Oturum-içi TEK giriş (App `Root` bunu yalnız oturum-dışı dalı DEĞİLKEN çizer; K5'te bağlanmaz):
 * salon TV'si (`#/tezgah-tv`) menü/sekme kabuğu olmadan, diğer her yol kabukla. Oturum-içi yeni
 * bir yüzey buradan dallanır ki lisans K5 kapısının arkasında kalsın (`test_lisans_k5_giris`).
 */
export function AppShell() {
  const hashPath = useHashPath();
  return hashPath === TEZGAH_TV_PATH ? <WeavingFloorTvScreen /> : <MenuShell />;
}

function MenuShell() {
  // Kapanışta açık kalan salon TV'si (aynı/ayrı pencere) geri gelir — Electron, süreç başına bir kez.
  useTvRestore();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Barkod tabancası — "her yerde okut" (opt-in, default kapalı). Wedge global
  // keydown'ı dinler, nitelikli burst'ü store'a iter; overlay sonucu gösterir.
  const { config } = useMachineConfig();
  const scannerPrefs = config.scanner;
  const pushScan = useScannerStore((s) => s.pushScan);
  const wedgeConfig = useMemo(
    () => ({
      terminator: scannerPrefs?.terminator,
      maxInterKeyMs: scannerPrefs?.maxInterKeyMs,
      minLength: scannerPrefs?.minLength,
    }),
    [scannerPrefs?.terminator, scannerPrefs?.maxInterKeyMs, scannerPrefs?.minLength],
  );
  const { isCapturing } = useScannerWedge({
    enabled: scannerPrefs?.scanAnywhere ?? false,
    onScan: (r) => pushScan(r.code, "wedge"),
    config: wedgeConfig,
  });
  // Faz-2: seri/HID cihaz okuyucu (opt-in) — aynı pushScan boru hattını besler.
  useDeviceScanner();
  // Bu PC'yi backend'e tanıt (announce) → admin makineye atayabilsin (sevkiyat
  // kantarı vb.). Gate yok; best-effort.
  useDeviceAnnounce();

  useGlobalShortcuts({
    onOpenCommand: () => setPaletteOpen(true),
    onOpenHelp: () => setHelpOpen(true),
    isScannerCapturing: isCapturing,
  });
  useTabShortcuts();
  useServerHeartbeat();
  // Güncelleme sonrası "neler değişti" penceresi — kararı açılışta verir.
  const { kuruluSurum } = useSurumNotuAcilis();
  // Her oturum açılışında güncelleme kontrolü (açılış + 15 dk'lık ritme ek).
  useGirisGuncellemeKontrolu();
  useIdleLogout();
  useExpiryAutoLogout();
  // Backend satıcıya çıkamıyorsa imzalı lisans isteğini bu bilgisayarın ağından taşır.
  useLicenseRelay();
  usePdfLicenseWatermark();

  const toggleSidebar = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* sessiz geç */
      }
      return next;
    });

  return (
    <div className="app-bg flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <Topbar
        onToggleSidebar={toggleSidebar}
        onOpenCommand={() => setPaletteOpen(true)}
      />
      <ShellBanners />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <TabHost />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={() => setHelpOpen(true)}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ScanResultOverlay />
      <SurumNotlariDialog kuruluSurum={kuruluSurum} />
    </div>
  );
}
