import { useEffect, useRef } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { CopyContextMenu } from "@/components/CopyContextMenu";
import { MotionProvider } from "@/components/motion";
import { PreferencesProvider } from "@/providers/PreferencesProvider";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { authRouter } from "./router";
import { useAuthStore } from "@/store/auth";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt, jwtPayloadExpiryMs } from "@/lib/jwt";
import { canEnterApp } from "@/types/auth";

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
        } else {
          await tokenStore.clear();
        }
      }
      setHydrated(true);
    })();
  }, [setUser, setHydrated]);

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

  if (!isHydrated) return null;
  if (!user || !canEnterApp(user.permissions)) {
    return <RouterProvider router={authRouter} />;
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
          <PreferencesProvider>
            <MotionProvider>
              <Root />
            </MotionProvider>
          </PreferencesProvider>
          <Toaster />
          <CopyContextMenu />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
