import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import type { UpdateStatus } from "@shared/ipc-contract";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

/**
 * KURULUM TETİĞİ HER EKRANDA — saha arızasının bekçisi (2026-09-28).
 *
 * ⭐ OLAY: `UpdateGate` yalnız `AppShell`de çiziliyordu. Giriş ekranında inen
 * 1.3.5 ve 1.3.6 hiç kurulmadı: rozet "yeniden başlatılacak" dedi ama kimse
 * `install()` çağırmadı; `autoInstallOnAppQuit=false` olduğundan kapatıp açmak
 * da kurmadı.
 *
 * ⭐ İDDİA: kapı `App` kökünde TEK kez çizilir; giriş ekranında ve tam panelde
 * paket hazırsa açılır ve süre dolunca `install()` çağrılır.
 */

vi.mock("@/lib/secure-token", () => ({
  tokenStore: { get: async () => null, set: async () => {}, clear: async () => {} },
}));
vi.mock("@/lib/scanner/barcode-kind", () => ({ loadScanSeries: async () => {} }));
vi.mock("@/hooks/useClientPolicy", () => ({ useClientPolicy: () => null }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: () => <div data-testid="kabuk-app" />,
}));
vi.mock("@/components/settings/SettingsPasswordDialog", () => ({
  SettingsPasswordDialog: () => null,
}));
vi.mock("@/components/LiveReferencesDialog", () => ({ LiveReferencesDialog: () => null }));
vi.mock("@/components/CopyContextMenu", () => ({ CopyContextMenu: () => null }));
vi.mock("@/providers/PreferencesProvider", () => ({
  PreferencesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: "light", setTheme: () => {} }),
}));
vi.mock("@/router", async () => {
  const { createMemoryRouter } = await import("react-router-dom");
  return {
    authRouter: createMemoryRouter([{ path: "*", element: <div data-testid="giris" /> }]),
  };
});

const { App } = await import("@/App");

const install = vi.fn();

function updater(state: UpdateStatus["state"]) {
  const durum: UpdateStatus = {
    state,
    currentVersion: "1.3.4",
    newVersion: "1.3.6",
    lastCheckedAt: null,
    feedUrl: "https://guncelleme.example/testfabrika/electron/",
    feedUrlOverridden: false,
    enabled: true,
  };
  (window as unknown as { api: unknown }).api = {
    updater: {
      status: () => Promise.resolve(durum),
      check: vi.fn(),
      install,
      setFeedUrl: vi.fn(),
      onStatus: () => () => {},
    },
  };
}

const oturumAc = () =>
  useAuthStore.setState({
    user: { userId: "u1", username: "op", permissions: ["roll:read"] } as unknown as JwtPayload,
  });

/** Mikro görevleri (hydrate + updater.status) boşaltır. */
const bosalt = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

const kapi = () => screen.queryByRole("alertdialog", { name: /Güncelleme kurulacak/ });

beforeEach(() => {
  vi.useFakeTimers();
  install.mockReset();
  window.location.hash = "";
  useAuthStore.setState({ user: null, isHydrated: false });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { api?: unknown }).api;
});

describe("kurulum tetiği — her ekranda", () => {
  it("⭐ giriş ekranında paket hazırsa kapı açılır ve kısa sayımla kurar", async () => {
    updater("ready");
    render(<App />);
    await bosalt();
    expect(screen.getByTestId("giris")).toBeInTheDocument();
    expect(kapi()).toBeInTheDocument();
    expect(screen.getByText("15 saniye")).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(16_000);
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("giriş ekranında 'Şimdi kur' anında kurar", async () => {
    updater("ready");
    render(<App />);
    await bosalt();
    fireEvent.click(screen.getByRole("button", { name: /Şimdi kur/ }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("tam panelde kapı açılır, oturum sayımı 2 dakika korunur", async () => {
    updater("ready");
    render(<App />);
    await bosalt();
    act(() => oturumAc());
    await bosalt();
    expect(screen.getByTestId("kabuk-app")).toBeInTheDocument();
    expect(kapi()).toBeInTheDocument();
    expect(screen.getByText("2 dk 00 sn")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(install).not.toHaveBeenCalled();
  });

  it("paket hazır değilse giriş ekranında kapı yok", async () => {
    updater("downloading");
    render(<App />);
    await bosalt();
    expect(screen.getByTestId("giris")).toBeInTheDocument();
    expect(kapi()).toBeNull();
  });
});

describe("tek bileşen — kopya yok (kaynak taraması)", () => {
  const SRC = path.resolve(process.cwd(), "src");
  const dosyalar = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [p] : [];
    });
  })(SRC);
  const yorumsuz = (c: string) =>
    c
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("`<UpdateGate` yalnız App.tsx'te ve bir kez çizilir", () => {
    const yerler = dosyalar.flatMap((f) => {
      const n = (yorumsuz(readFileSync(f, "utf8")).match(/<UpdateGate\b/g) ?? []).length;
      return n > 0 ? [`${path.relative(SRC, f)}:${n}`] : [];
    });
    expect(yerler).toEqual(["App.tsx:1"]);
  });
});
