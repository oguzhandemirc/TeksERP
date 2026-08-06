import { useCallback, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { FindBar } from "./FindBar";
import { TabHost } from "./tabs";
import { ScanResultOverlay } from "@/components/scanner/ScanResultOverlay";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";
import { useFindShortcut } from "@/hooks/useFindShortcut";
import { useServerHeartbeat } from "@/hooks/useServerClock";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useExpiryAutoLogout } from "@/hooks/useExpiryAutoLogout";
import { useScannerWedge } from "@/hooks/useScannerWedge";
import { useDeviceScanner } from "@/hooks/useDeviceScanner";
import { useDeviceAnnounce } from "@/hooks/useDeviceAnnounce";
import { useScannerStore } from "@/store/scanner";
import { useMachineConfig } from "@/hooks/useMachineConfig";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Sayfa içi arama (Ctrl+F). `useCallback` şart: `useFindShortcut` bağımlılığı
  // her render'da değişirse dinleyici sürekli sökülüp takılırdı.
  const [findOpen, setFindOpen] = useState(false);
  const openFind = useCallback(() => setFindOpen(true), []);
  const closeFind = useCallback(() => setFindOpen(false), []);

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
  useFindShortcut(openFind);
  useTabShortcuts();
  useServerHeartbeat();
  useIdleLogout();
  useExpiryAutoLogout();

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
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <TabHost />
          {/* Sayfa içi arama — main relative olduğu için çubuk içerik alanının
              sağ üstüne oturur; sekme değişse de açık kalır (tarayıcı gibi). */}
          <FindBar open={findOpen} onClose={closeFind} />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={() => setHelpOpen(true)}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ScanResultOverlay />
    </div>
  );
}
