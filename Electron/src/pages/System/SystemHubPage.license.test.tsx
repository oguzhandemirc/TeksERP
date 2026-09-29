import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import { systemTiles } from "./tile-config";

const status = vi.fn();
vi.mock("@/services/licenseService", () => ({ licenseService: { status: () => status() } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
const { SystemHubPage } = await import("./SystemHubPage");

const summary = (kip: "gozlem" | "zorla") => ({
  ayrinti: true, kip, kademe: "NORMAL", bant: null, ekSureKalanGun: null, kisitlamaKalanGun: null,
  guncellemeIzni: true, sinif: null, lisansNo: null, lisansSahibi: null, surum: "2.12.0",
});

/**
 * LİSANS KAROSU — gözlemde yalnız satıcı kapısı açık oturuma (plan §4: "durum
 * yalnız süperadmin lisans sayfasında"); zorlamada izin yeter. Hakkında karosu
 * kapıya tabi değil (görünür filigran).
 */
describe("Sistem hub'ı — lisans karosu", () => {
  beforeEach(() => {
    status.mockReset();
    useAuthStore.setState({ user: { userId: "u1", username: "y", permissions: ["*"] } as unknown as JwtPayload });
  });

  it("karo tanımı: izin kümesi + gözlem kapısı; Hakkında kapısız ama izinli", () => {
    const lic = systemTiles.find((t) => t.key === "license");
    expect(lic?.permissionAny).toEqual(["license:view", "license:manage"]);
    expect(lic?.licenseObservationGate).toBe(true);
    const about = systemTiles.find((t) => t.key === "about");
    expect(about?.permission).toBe("license:view");
    expect(about?.licenseObservationGate).toBeUndefined();
  });

  it("⭐ gözlem + fabrika yöneticisi (sistem hesabı VAR) → Lisans karosu YOK, Hakkında VAR", async () => {
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
    status.mockResolvedValue(summary("gozlem"));
    renderWithProviders(<SystemHubPage />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    // Sorgu sonucunun yeniden çizimi: "yok" iddiası veri geldikten SONRA anlamlıdır.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.queryByText("Lisans")).toBeNull();
    expect(screen.getByText("Hakkında")).toBeInTheDocument();
  });

  it("gözlem + satıcı hesabı → Lisans karosu VAR", async () => {
    useAuthStore.setState({ isSystemAccount: true, systemAccountExists: true });
    status.mockResolvedValue(summary("gozlem"));
    renderWithProviders(<SystemHubPage />);
    expect(await screen.findByText("Lisans")).toBeInTheDocument();
  });

  it("zorlama + fabrika yöneticisi → Lisans karosu VAR (izin yeter)", async () => {
    useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
    status.mockResolvedValue(summary("zorla"));
    renderWithProviders(<SystemHubPage />);
    expect(await screen.findByText("Lisans")).toBeInTheDocument();
  });
});
