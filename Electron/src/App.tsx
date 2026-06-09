import { useEffect } from "react";
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
import { decodeJwt } from "@/lib/jwt";
import { canEnterApp } from "@/types/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
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
        if (decoded) setUser(decoded);
        else await tokenStore.clear();
      }
      setHydrated(true);
    })();
  }, [setUser, setHydrated]);

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
