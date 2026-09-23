import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, UNSAFE_LocationContext, NavigationType } from "react-router-dom";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { ForbiddenPage } from "@/pages/Forbidden/ForbiddenPage";
import { ProtectedRoute } from "./ProtectedRoute";

// =============================================================================
// K26 — kapalı modülün sayfası /forbidden'a GEÇİŞTE bağlanmamalı.
//
// Kapı `useLocation()`a bakıyordu. /forbidden'a geçişte ESKİ rota öğesi YENİ konumla bir kez daha
// çizilir. "/forbidden"ın modülü yok → kapı açılıyordu. Kapalı finans sekmelerinin sayfaları bağlanıp
// sorgularını atıyordu (e2e K26 sondası: 8×403 + 12 "yetkiniz yok" toast'ı).
// Burada o çizim birebir kurulur: rota bağlamı finans, konum bağlamı "/forbidden".
// =============================================================================

let permissions: string[] = ["finance:read"];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
  }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false,
    reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false,
    financeEnabled: false, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false,
  }),
}));
vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { permissions: ["finance:read"] }, isHydrated: true, isSystemAccount: false, systemAccountExists: false }),
}));

const sayfaCizildi = vi.fn();
function FinansSayfasi() {
  sayfaCizildi();
  return <div>FINANS-SAYFASI</div>;
}

/** Geçişteki çizim: rota eşleşmesi finans, konum bağlamı ise hedef ("/forbidden"). */
function KonumOnde({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  return (
    <UNSAFE_LocationContext.Provider
      value={{ location: { pathname, search: "", hash: "", state: null, key: "gecis" }, navigationType: NavigationType.Replace }}
    >
      {children}
    </UNSAFE_LocationContext.Provider>
  );
}

describe("ProtectedRoute — modül kapısı KORUDUĞU ROTAYA bakar (K26)", () => {
  beforeEach(() => {
    sayfaCizildi.mockClear();
    permissions = ["finance:read"];
  });

  it("⭐ geçiş çizimi: rota /finance/invoices, konum /forbidden → kapalı modülün sayfası ÇİZİLMEZ", () => {
    render(
      <MemoryRouter initialEntries={["/finance/invoices"]}>
        <Routes>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route
            path="/finance/invoices"
            element={
              <KonumOnde pathname="/forbidden">
                <ProtectedRoute requirePermission="finance:read">
                  <FinansSayfasi />
                </ProtectedRoute>
              </KonumOnde>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(sayfaCizildi).not.toHaveBeenCalled();
    expect(screen.queryByText("FINANS-SAYFASI")).toBeNull();
  });

  it("⭐ modül kapısından /forbidden → 'Modül kapalı' (yetki cümlesi değil)", () => {
    render(
      <MemoryRouter initialEntries={["/finance/invoices"]}>
        <Routes>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="/finance/invoices" element={<ProtectedRoute requirePermission="finance:read"><FinansSayfasi /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Modül kapalı")).toBeInTheDocument();
    expect(screen.queryByText(/yetkin yok/)).toBeNull();
  });

  it("izin kapısından /forbidden → yetki cümlesi (bugünkü davranış)", () => {
    permissions = [];
    render(
      <MemoryRouter initialEntries={["/finance/invoices"]}>
        <Routes>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="/finance/invoices" element={<ProtectedRoute requirePermission="finance:read"><FinansSayfasi /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Erişim engellendi")).toBeInTheDocument();
    expect(sayfaCizildi).not.toHaveBeenCalled();
  });
});
