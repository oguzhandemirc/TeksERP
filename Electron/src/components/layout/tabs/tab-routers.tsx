import { createMemoryRouter } from "react-router-dom";
import { contentRoutes } from "@/routes/content-routes";
import { TabRootLayout } from "./TabRootLayout";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";

type TabRouter = ReturnType<typeof createMemoryRouter>;

/** "/x?focus=1" → memory router'ın anlayacağı başlangıç girişi (state varsa nesne). */
function toEntry(path: string, state?: unknown) {
  const [pathname, query] = path.split("?");
  const search = query ? `?${query}` : "";
  if (state !== undefined) {
    return { pathname: pathname || "/", search, hash: "", state };
  }
  return search ? `${pathname}${search}` : pathname || "/";
}

function build(path: string, state?: unknown): TabRouter {
  return createMemoryRouter(
    [{ path: "/", element: <TabRootLayout />, errorElement: <RouteErrorFallback />, children: contentRoutes }],
    { initialEntries: [toEntry(path, state)], initialIndex: 0 },
  );
}

// Sekme id → kendi izole memory router'ı. Sekme ömrü boyunca tek örnek yaşar;
// böylece konum/searchParams/geçmiş ve mount edilmiş sayfa durumu korunur.
const registry = new Map<string, TabRouter>();

/** Sekmenin router'ını döndürür; ilk çağrıda kurar (idempotent). */
export function getTabRouter(id: string, path: string, state?: unknown): TabRouter {
  let router = registry.get(id);
  if (!router) {
    router = build(path, state);
    registry.set(id, router);
  }
  return router;
}

/** Mevcut bir sekmeyi (zaten kurulu router'ıyla) yeni bir yola taşır. */
export function navigateTabRouter(id: string, path: string, state?: unknown): boolean {
  const router = registry.get(id);
  if (!router) return false;
  void router.navigate(toEntry(path, state) as string, state !== undefined ? { state } : undefined);
  return true;
}

/** Sekme kapanınca router'ı serbest bırakır (listener/abort temizliği). */
export function disposeTabRouter(id: string): void {
  registry.get(id)?.dispose();
  registry.delete(id);
}
