import { useEffect, useRef } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { CopyContextMenu } from "@/components/CopyContextMenu";
import { MotionProvider } from "@/components/motion";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { AppShell } from "@/components/layout/AppShell";
import { TitleBar } from "@/components/layout/TitleBar";
import { BossShell } from "@/components/layout/BossShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsPasswordDialog } from "@/components/settings/SettingsPasswordDialog";
import { authRouter } from "./router";
import { useAuthStore } from "@/store/auth";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt, jwtPayloadExpiryMs } from "@/lib/jwt";
import { canEnterApp } from "@/types/auth";
import { TOTP_ENROLL_PATH } from "@/lib/totp-enroll-url";
import { BOSS_PATH } from "@/lib/boss-path";
import { useHashPath } from "@/lib/use-hash-path";

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
      staleTime: 5 * 60 * 1000,
    },
  },
});

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

  if (!isHydrated) return null;
  // ⚠️ 2FA KURULUM SAYFASI OTURUM DURUMUNDAN BAĞIMSIZ AÇILIR.
  // Bağlantı çoğu zaman giriş yapmamış birine gider, ama giriş YAPMIŞ bir
  // makinede açılırsa (yönetici kendi ekranında denerken, ya da kullanıcı
  // fabrikada oturum açıkken) `AppShell` çizilir ve `#/2fa-kurulum` hiçbir
  // içerik rotasına uymadığı için BOŞ SAYFA görünürdü — hata yok, log yok.
  const onEnrollPath = hashPath === TOTP_ENROLL_PATH;
  if (onEnrollPath || !user || !canEnterApp(user.permissions)) {
    return <RouterProvider router={authRouter} />;
  }
  // PATRON KABUĞU — `#/boss` ile açılır. `AppShell`in sekme şeridi + sidebar'ı
  // telefonda kullanılamıyor; patron ekranı tek iş yaptığı için ince kabuk
  // yeterli. Kabuk `content-routes`u AYNI router altyapısıyla çalıştırır, yani
  // detaya iniş bugünkü ekranlarla sorunsuz çalışır (bkz. BossShell başlığı).
  if (hashPath === BOSS_PATH || hashPath.startsWith(`${BOSS_PATH}/`)) {
    return <BossShell />;
  }
  return <AppShell />;
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <AuthHydrator />
          <CacheUserGuard />
          {/* Kendi başlık çubuğumuz — pencere `frame: false` ile açılır.
              ⚠️ `Root`tan ÖNCE ve provider'ların DIŞINDA değil İÇİNDE: tema
              sınıfını (`ThemeProvider`) okur, yoksa açık/koyu geçişinde şerit
              bir kare geride kalır. macOS ve tarayıcıda kendini çizmez. */}
          <TitleBar />
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
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
