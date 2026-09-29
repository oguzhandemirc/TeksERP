// Uygulama kökü: sorgu önbelleği + oturum + (girişliyse) yönlendirici. Girişsiz kullanıcı yalnız
// giriş ekranını görür; oturum düşünce önbellek temizlenir ve giriş ekranına dönülür.
import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter, type RouteObject } from "react-router-dom";
import { isAmbiguousError, type ApiBase } from "./api";
import { LoginPage } from "./LoginPage";
import { SessionProvider, useSession } from "./session";
import { Loading } from "./ui";

export type RouterFactory = (routes: RouteObject[]) => ReturnType<typeof createBrowserRouter>;

export interface AppRootProps {
  readonly base: ApiBase;
  readonly product: string;
  readonly routes: RouteObject[];
  readonly createRouter: RouterFactory;
  readonly fetchImpl?: typeof fetch;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Okuma yalnız belirsiz hatada (ağ/5xx) bir kez yinelenir; yazma asla kendiliğinden yinelenmez.
      queries: { retry: (count, err) => count < 1 && isAmbiguousError(err), staleTime: 10_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function Gate({ product, routes, createRouter }: Pick<AppRootProps, "product" | "routes" | "createRouter">) {
  const { state } = useSession();
  const userId = state.status === "in" ? state.session.kullanici.id : null;
  const router = useMemo(() => (userId ? createRouter(routes) : null), [userId, routes, createRouter]);
  if (state.status === "loading") return <Loading />;
  if (state.status === "out" || !router) return <LoginPage product={product} expired={state.status === "out" && state.reason === "expired"} />;
  return <RouterProvider router={router} />;
}

export function AppRoot({ base, product, routes, createRouter, fetchImpl }: AppRootProps) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider base={base} fetchImpl={fetchImpl}>
        <Gate product={product} routes={routes} createRouter={createRouter} />
      </SessionProvider>
    </QueryClientProvider>
  );
}
