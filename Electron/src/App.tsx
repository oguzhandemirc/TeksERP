import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { router } from "./router";
import { useAuthStore } from "@/store/auth";
import { tokenStore } from "@/lib/secure-token";
import { decodeJwt } from "@/lib/jwt";

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

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthHydrator />
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
