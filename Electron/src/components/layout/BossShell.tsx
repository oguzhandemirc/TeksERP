import { useState } from "react";
import { RouterProvider } from "react-router-dom";
import { LayoutGrid, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { canEnterApp } from "@/types/auth";
import { getTabRouter } from "./tabs/tab-routers";
import { TabActiveProvider, TabIdProvider } from "./tabs/tab-active";
import { TabPortalProvider } from "./tabs/tab-portal";
import { ServerOfflineBanner } from "./ServerOfflineBanner";
import { BOSS_PATH } from "@/lib/boss-path";

/**
 * PATRON KABUĞU — sekme sistemi BYPASS edilir.
 *
 * ⚠️ NEDEN `AppShell` KULLANILMIYOR. O kabuk "uygulama içinde tarayıcı
 * sekmeleri" modelidir: sidebar + sekme şeridi + komut paleti + tarayıcı
 * kısayolları. Telefon genişliğinde sekme şeridi tek başına ekranın üçte birini
 * yer ve dokunmatikte kapatma düğmeleri isabet almaz. Patron ekranı tek bir işi
 * yapıyor; ona bir pencere yöneticisi vermek gereksiz.
 *
 * ⚠️ AMA ROUTER ALTYAPISI AYNEN KULLANILIR (`getTabRouter`). Kendi router'ımı
 * kurmak cazipti; yanlış olurdu: `content-routes` sayfaları `useTabId`,
 * `TabPortalProvider` ve geçmiş defterine (`history-depth`) bağlı — bunlar
 * olmadan `PageHeader`ın geri oku sessizce ölür ve modaller yanlış yere
 * portallanır. Tek "boss" sekmesi açıp aynı makineyi kullanmak, detaya inişin
 * (Envanter, Karşılanma, Kanban) BUGÜNKÜ ekranlarla çalışmasını sağlıyor.
 */
const BOSS_TAB_ID = "boss";

export function BossShell() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme } = useTheme();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const router = getTabRouter(BOSS_TAB_ID, BOSS_PATH);

  // Tam panele geçiş yalnız ORAYA GİREBİLENE gösterilir. Yalnız patron yetkisi
  // olan biri için o düğme, tıklayınca boş bir kabuk açan bir tuzak olurdu.
  const canOpenFullPanel = Boolean(user && canEnterApp(user.permissions));

  return (
    <div className="app-viewport flex w-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Fabrika Özeti</p>
          <p className="truncate text-[11px] text-muted-foreground">{user?.username}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canOpenFullPanel && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                // Hash'i temizlemek `Root` kapısını AppShell'e çevirir.
                window.location.hash = "#/";
              }}
              title="Tam panele geç"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Tema değiştir"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void logout()}
            aria-label="Çıkış"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ServerOfflineBanner />

      {/* `TabHost`un kutu sözleşmesinin aynısı: dış kutu konumlandırır, iç kutu
          TEK kaydırıcıdır. Sayfalar (PageShell/PageBody) buna göre yazılmış. */}
      <div ref={setContainer} className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-auto">
          <TabActiveProvider value={true}>
            <TabIdProvider value={BOSS_TAB_ID}>
              <TabPortalProvider value={container}>
                <RouterProvider router={router} />
              </TabPortalProvider>
            </TabIdProvider>
          </TabActiveProvider>
        </div>
      </div>
    </div>
  );
}
