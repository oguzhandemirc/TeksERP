import { Fragment, useEffect, useRef } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { CopyContextMenu } from "@/components/CopyContextMenu";
import { MotionProvider } from "@/components/motion";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { AppShell } from "@/components/layout/AppShell";
import { UpdateGate } from "@/components/layout/UpdateGate";
import { LicenseLockGate } from "@/components/layout/LicenseLockGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsPasswordDialog } from "@/components/settings/SettingsPasswordDialog";
import { LiveReferencesDialog } from "@/components/LiveReferencesDialog";
import { authRouter } from "./router";
import { useAuthStore } from "@/store/auth";
import { useLicenseSuspension } from "@/lib/license/suspension";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt, jwtPayloadExpiryMs } from "@/lib/jwt";
import { canEnterApp } from "@/types/auth";
import { TOTP_ENROLL_PATH } from "@/lib/totp-enroll-url";
import { useHashPath } from "@/lib/use-hash-path";
import { loadScanSeries } from "@/lib/scanner/barcode-kind";
import { DEFAULT_STALE_MS, applyQueryFreshness } from "@/lib/query-freshness";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useFactoryTimezone } from "@/lib/factory-time-react";
import { isTvWindowHash } from "@shared/tv-window";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // L fix: deterministik 4xx'i (401/403/404/validasyon) yeniden DENEME —
      // aynı cevabı bir kez daha alıp hata anını geciktiriyordu. Ağ/5xx tek retry.
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } } | null)?.response
          ?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      // K21: başka istemcinin kaydı en geç 30 sn'de görünür; para/katalog istisnaları `query-freshness`ta.
      staleTime: DEFAULT_STALE_MS,
    },
  },
});
applyQueryFreshness(queryClient);

function AuthHydrator() {
  const setUser = useAuthStore((s) => s.setUser);
  const setHydrated = useAuthStore((s) => s.setHydrated);
  const refreshSystemAccount = useAuthStore((s) => s.refreshSystemAccount);

  useEffect(() => {
    void (async () => {
      const token = await tokenStore.get();
      if (token) {
        const decoded = decodeJwt(token);
        // L fix: süresi DOLMUŞ token'la uygulamayı açma — ilk istekte zaten 401
        // yenilecekti; exp kontrolüyle doğrudan login'e düşür (boş açılış yok).
        const expMs = jwtPayloadExpiryMs(decoded);
        if (decoded && (expMs === null || expMs > Date.now())) {
          setUser(decoded);
          // Token'da OLMAYAN kimlik alanları (sistem hesabı) sunucudan gelir —
          // arka planda, best-effort: açılışı bekletmez, düşerse fail-closed
          // varsayılanlar (yazma kapalı) yerinde kalır.
          void refreshSystemAccount();
        } else {
          await tokenStore.clear();
        }
      }
      setHydrated(true);
    })();
  }, [setUser, setHydrated, refreshSystemAccount]);

  return null;
}

/**
 * L fix: kullanıcı değişiminde/çıkışında React Query cache'i temizlenir —
 * önceki kullanıcının 5dk'lık stale verisi yeni oturumda ağa çıkmadan
 * gösterilmesin (farklı yetkili kullanıcılar aynı makinede nöbetleşir).
 */
/**
 * Barkod seri tablosunu giriş SONRASI çeker (uç `verifyToken` ister).
 * Düşerse sessizce yedek tabloda kalınır — okutma yolu fail-closed DEĞİL.
 */
function ScanSeriesLoader() {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  // K5'te yalnız "verilerimi al" sayfası konuşur; uç DURDURULMUŞ izin listesinde değil.
  const suspended = useLicenseSuspension((s) => s.suspended);
  useEffect(() => {
    if (!userId || suspended) return;
    void loadScanSeries();
  }, [userId, suspended]);
  return null;
}

/**
 * Fabrika saat dilimini giriş SONRASI yükler (bayrak ucu `verifyToken` ister): `featureFlagService.get`
 * dilimi `lib/factory-time`a uygular. Yüklenene kadar varsayılan dilim (Europe/Istanbul) geçerlidir.
 */
function FactoryTimezoneLoader() {
  useFeatureFlags();
  return null;
}

function CacheUserGuard() {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current !== null && prev.current !== userId) {
      queryClient.clear();
    }
    prev.current = userId;
  }, [userId]);
  return null;
}

/**
 * Üst seviye kapı: kimlik durumuna göre oturum-dışı router'ı ya da uygulama
 * kabuğunu (AppShell + sekmeler) gösterir. AppShell bilerek bir data-router'ın
 * DIŞINDA render edilir — böylece her sekmenin memory router'ı tek katmandır,
 * iç içe geçmez.
 */
function Root() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const user = useAuthStore((s) => s.user);
  // ⚠️ REAKTİF OKUMA ŞART — düz `window.location.hash` React'e hiçbir şey
  // söylemez ve kabuk geçişleri tepkisiz kalır (bkz. `use-hash-path.ts`).
  const hashPath = useHashPath();
  // K5: kabuk (yüzlerce uç) hiç bağlanmaz; oturum-dışı router "verilerimi al" sayfasını açar.
  const licenseSuspended = useLicenseSuspension((s) => s.suspended);
  // Dilim değişince kabuk YENİDEN KURULUR: çizilmiş her tarih/saat yeni dilimle basılsın (nadir — kurulum değeri).
  const factoryTimezone = useFactoryTimezone();

  if (!isHydrated) return null;
  // ⚠️ 2FA KURULUM SAYFASI OTURUM DURUMUNDAN BAĞIMSIZ AÇILIR.
  // Bağlantı çoğu zaman giriş yapmamış birine gider, ama giriş YAPMIŞ bir
  // makinede açılırsa (yönetici kendi ekranında denerken, ya da kullanıcı
  // fabrikada oturum açıkken) `AppShell` çizilir ve `#/2fa-kurulum` hiçbir
  // içerik rotasına uymadığı için BOŞ SAYFA görünürdü — hata yok, log yok.
  const onEnrollPath = hashPath === TOTP_ENROLL_PATH;
  // Ayrı salon TV penceresi kurulum tetiği taşımaz: güncellemeyi ana pencere kurar (iki geri sayım olmasın).
  const tvPenceresi = isTvWindowHash(window.location.hash);
  const oturumDisi = onEnrollPath || !user || !canEnterApp(user.permissions) || licenseSuspended;
  let kabuk;
  if (oturumDisi) {
    kabuk = <RouterProvider router={authRouter} />;
  } else {
    // Oturum-içi her yüzey (salon TV'si `#/tezgah-tv` dahil) AppShell'den dallanır: K5'te bağlanmaz.
    // Oturum düşerse yukarıdaki dal girişe götürür, giriş aynı yola döner (`AuthLanding`).
    kabuk = <AppShell />;
  }
  // ⚠️ KURULUM TETİĞİ HER EKRANDA, TEK YERDE: yalnız kabukta çizildiğinde giriş
  // ekranında inen paket hiç kurulmuyordu. Kardeş konumu sabit — kabuk değişse
  // de geri sayım durumu korunur.
  // Lisans kilidi de kabuktan bağımsız, AYNI katmanda; yalnız oturumda (durum
  // ayrıntısı kimliksize verilmez). Gözlemde kademe NORMAL → hiç çizilmez.
  return (
    <>
      <Fragment key={factoryTimezone}>{kabuk}</Fragment>
      {!oturumDisi && <LicenseLockGate />}
      {!oturumDisi && <FactoryTimezoneLoader />}
      {!tvPenceresi && <UpdateGate girisEkrani={oturumDisi} />}
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <AuthHydrator />
          <CacheUserGuard />
          <ScanSeriesLoader />
          <PreferencesProvider>
            <MotionProvider>
              <Root />
            </MotionProvider>
          </PreferencesProvider>
          <Toaster />
          <CopyContextMenu />
          {/* Ayar şifresi sorusu — App düzeyinde TEK mount. Açılışını bir
              kullanıcı jesti değil, `withSettingsPassword`ın gördüğü 403
              tetikler; bu yüzden yazma yüzeylerinin yanında değil burada durur
              (iki yüzeyden iki diyalog üst üste binmesin). */}
          <SettingsPasswordDialog />
          <LiveReferencesDialog />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
