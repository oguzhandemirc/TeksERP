import type { ReactElement } from "react";
import { createMemoryRouter } from "react-router-dom";
import { contentRoutes } from "@/routes/content-routes";
import { TabRootLayout } from "./TabRootLayout";
import { BossRootLayout } from "@/components/layout/BossRootLayout";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";
import { rememberRoute } from "./route-memory";
import { canGoBackTab, forgetTab, trackTabLocation } from "./history-depth";

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

function build(id: string, path: string, state?: unknown, root?: ReactElement): TabRouter {
  const router = createMemoryRouter(
    [{ path: "/", element: root ?? <TabRootLayout />, errorElement: <RouteErrorFallback />, children: contentRoutes }],
    { initialEntries: [toEntry(path, state)], initialIndex: 0 },
  );
  // Sekmenin her konum değişimini (a) rota hafızasına yaz — aynı sayfaya sonradan
  // dönüldüğünde filtre/sıralama son hâlinden açılsın — ve (b) geçmiş derinliği
  // defterine işle (geri tuşunun TEK doğru kaynağı; bkz. `history-depth.ts`).
  // Abonelik router'ın ömrüne bağlı; `dispose()` onu da kapatır.
  trackTabLocation(id, router.state.location.key, router.state.historyAction);
  router.subscribe((state) => {
    rememberRoute(state.location.pathname, state.location.search);
    trackTabLocation(id, state.location.key, state.historyAction);
  });
  return router;
}

// Sekme id → kendi izole memory router'ı. Sekme ömrü boyunca tek örnek yaşar;
// böylece konum/searchParams/geçmiş ve mount edilmiş sayfa durumu korunur.
const registry = new Map<string, TabRouter>();

/** Sekmenin router'ını döndürür; ilk çağrıda kurar (idempotent). */
export function getTabRouter(id: string, path: string, state?: unknown): TabRouter {
  let router = registry.get(id);
  if (!router) {
    router = build(id, path, state);
    registry.set(id, router);
  }
  return router;
}

/**
 * ÖZET GÖRÜNÜMÜNÜN (BossShell) router'ı — aynı altyapı, KAPILI kök layout.
 *
 * ⚠️ Ayrı bir `createMemoryRouter` YAZILMAZ, `build` kullanılır: rota hafızası
 * (`rememberRoute`) ve geçmiş derinliği defteri (`trackTabLocation`) burada
 * kuruluyor ve `PageHeader`ın geri oku ONLARA bağlı. Kendi router'ını kuran bir
 * kabuk, geri okunu sessizce öldürür (BossShell başlığında yazılı ders).
 *
 * ⚠️ Kabuk farkı TEK YERDE: kök eleman. Kapının kendisi `BossRootLayout`ta,
 * yüklem `lib/boss-menu.ts`te — bu fonksiyon yalnız ikisini birbirine bağlar.
 */
export function getBossTabRouter(id: string, path: string): TabRouter {
  let router = registry.get(id);
  if (!router) {
    router = build(id, path, undefined, <BossRootLayout />);
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

/**
 * Sekmenin KENDİ geçmişinde bir adım geri. Geri gidilecek adım yoksa hiçbir şey
 * yapmaz ve `false` döner — çağıran "geri gidilecek yer yok"u bilir ve sessiz bir
 * tık yerine kendi yedeğine (breadcrumb üstü) düşebilir. Uygunluk `location.key`
 * ile DEĞİL derinlik defteriyle çözülür (REPLACE tuzağı — `history-depth.ts`).
 */
export function goBackTabRouter(id: string): boolean {
  const router = registry.get(id);
  if (!router || !canGoBackTab(id)) return false;
  void router.navigate(-1);
  return true;
}

/** Sekme kapanınca router'ı serbest bırakır (listener/abort temizliği). */
export function disposeTabRouter(id: string): void {
  registry.get(id)?.dispose();
  registry.delete(id);
  forgetTab(id);
}
