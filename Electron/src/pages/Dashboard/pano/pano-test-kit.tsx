import { useSyncExternalStore } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { PanoBoxDef } from "./box-types";

// Pano davranış testlerinin ortak düzeneği (yeni test dosyaları için): izin, bayrak, tercih deposu ve
// kutu isteği sahteleri. Durum `kit` nesnesinde; testler alanları atayarak kurar.
export const kit = {
  permissions: ["admin:*"] as string[],
  prefs: {} as Record<string, unknown> & { dashboard?: Record<string, unknown> },
  data: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  setPreference: vi.fn(),
  fetchPanoCatalog: vi.fn(),
  fetchPanoBoxes: vi.fn(),
  navigateActive: vi.fn(),
};
const has = (p: string) => kit.permissions.includes(p) || kit.permissions.includes("admin:*");

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: has, hasAnyPermission: (ps: string[]) => ps.some(has) }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false,
    dokumaEnabled: true, machineStopEnabled: false, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: true,
    gelenBelgeEnabled: true, emanetEnabled: false, reportsClosedKeys: [], isReportOpen: () => true,
    flagsReady: true, flagsFailed: false, financeEnabled: true, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false,
  }),
}));
vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: { username: "ayse" } }) }));
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive: kit.navigateActive }) }));
vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => {
    const p = useSyncExternalStore((l) => { kit.listeners.add(l); return () => kit.listeners.delete(l); }, () => kit.prefs);
    return {
      prefs: p,
      setPreference: (fn: ((cur: typeof kit.prefs) => typeof kit.prefs) | typeof kit.prefs) => {
        const patch = typeof fn === "function" ? fn(kit.prefs) : fn;
        kit.setPreference(patch);
        setPrefs({ ...kit.prefs, ...patch });
      },
    };
  },
}));
vi.mock("@/components/insight/EChart", () => ({
  EChart: ({ label }: { label: string }) => <div data-testid="grafik">{label}</div>,
  withAlpha: (r: string) => r,
}));
vi.mock("../dashboardService", () => ({
  fetchPanoCatalog: () => kit.fetchPanoCatalog(),
  fetchPanoBoxes: (q: unknown) => kit.fetchPanoBoxes(q),
  fetchStationLiveState: () => Promise.resolve([]),
}));

/** Tercihi değiştirir ve abonelere duyurur (sağlayıcının yeniden çizimi). */
export function setPrefs(next: typeof kit.prefs): void {
  kit.prefs = next;
  kit.listeners.forEach((l) => l());
}

export const kitBox = (anahtar: string, boyut: PanoBoxDef["boyut"], varsayilan: boolean, donemli = true): PanoBoxDef => ({
  anahtar, baslik: anahtar, aciklama: `${anahtar} açıklaması`, grup: "uretim", donemli, varsayilan, boyut,
});

/** Kutu isteğini sahteler; her test öncesi çağrılır. */
export function resetKit(catalog: PanoBoxDef[], data: Record<string, unknown>, prefs: typeof kit.prefs = { dashboard: { donem: "bugun" } }): void {
  kit.permissions = ["admin:*"];
  kit.prefs = prefs;
  kit.data = data;
  kit.setPreference.mockReset();
  kit.navigateActive.mockReset();
  kit.fetchPanoCatalog.mockReset().mockResolvedValue(catalog);
  kit.fetchPanoBoxes.mockReset().mockImplementation(async (q: { kutular: string[] }) => ({
    kutular: Object.fromEntries(q.kutular.map((key) => [key, kit.data[key] ?? null])),
  }));
}

/** İstenen kutu listeleri (çağrı sırasıyla). */
export const kitRequested = () => kit.fetchPanoBoxes.mock.calls.map((c) => (c[0] as { kutular: string[] }).kutular);

export async function renderKitPano() {
  const { DashboardPage } = await import("../DashboardPage");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DashboardPage /></QueryClientProvider>);
}
