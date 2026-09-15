import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { ProtectedRoute } from "./ProtectedRoute";

// =============================================================================
// PANEL ROUTE MODÜL KAPISI — davranış bekçisi (1e üç sondası, 2026-09-14).
//
// 5e'nin ölçtüğü boşluk: `ProtectedRoute` yalnız izne bakıyordu; bayrak KAPALI +
// izin VAR (ör. `admin:*` yöneticisi) + adres çubuğundan URL → sayfa çiziliyor,
// backend 403 basıyordu. Karo ve palet gizliydi ama üçüncü yol açıktı.
// =============================================================================

let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p) || permissions.includes("admin:*"),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)) || permissions.includes("admin:*"),
  }),
}));

let regime: Partial<OperationsVisibilityContext> = {};
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false,
    depoMultiEnabled: false,
    devereEnabled: false,
    dokumaEnabled: false,
    reportsClosedKeys: [],
    isReportOpen: () => true,
    financeEnabled: false,
    productionEnabled: true,
    ticaretEnabled: false,
    iplikEnabled: false,
    ...regime,
  }),
}));

vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      user: { permissions: ["item:read"] },
      isHydrated: true,
      isSystemAccount: false,
      systemAccountExists: false,
    }),
}));

function renderAt(path: string, routePath: string, perm: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forbidden" element={<div>FORBIDDEN-SAYFASI</div>} />
        <Route
          path={routePath}
          element={
            <ProtectedRoute requirePermission={perm}>
              <div>EKRAN-ICERIGI</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute — modül kapısı", () => {
  beforeEach(() => {
    permissions = ["admin:*", "item:read", "weavingorder:read", "workorder:read"];
    regime = {};
  });

  it("⭐ KAPALI + izin VAR + URL → /forbidden (bayrak izni EZER)", () => {
    regime = { dokumaEnabled: false };
    renderAt("/operations/weaving-orders", "/operations/weaving-orders", "weavingorder:read");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
    expect(screen.queryByText("EKRAN-ICERIGI")).toBeNull();
  });

  it("⭐ AÇIK → sayfa çizilir (bugünkü davranış birebir)", () => {
    regime = { dokumaEnabled: true };
    renderAt("/operations/weaving-orders", "/operations/weaving-orders", "weavingorder:read");
    expect(screen.getByText("EKRAN-ICERIGI")).toBeInTheDocument();
  });

  it("⭐ modülü olmayan ekran dokunulmaz — bütün bayraklar kapalıyken de çizilir", () => {
    regime = { productionEnabled: false, financeEnabled: false, ticaretEnabled: false };
    renderAt("/definitions/items", "/definitions/items", "item:read");
    expect(screen.getByText("EKRAN-ICERIGI")).toBeInTheDocument();
  });

  it("⭐ bayrak OKUNAMADI (bağlam varsayılanı): üretim yolu ÇİZİLİR, dokuma yolu /forbidden — yön alan başına", () => {
    // Bağlamın gerçek varsayılanları `useOperationsVisibility.test.ts`te ölçülür;
    // burada o varsayılanla (production true · dokuma false) kapının kararı.
    regime = {};
    renderAt("/operations/work-orders", "/operations/work-orders", "workorder:read");
    expect(screen.getByText("EKRAN-ICERIGI")).toBeInTheDocument();
  });

  it("⭐ bayrak OKUNAMADI: dokuma yolu (satır-yok KAPALI) /forbidden", () => {
    regime = {};
    renderAt("/operations/weaving-orders", "/operations/weaving-orders", "weavingorder:read");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("alt yol ebeveyne katlanır: /operations/work-orders/:id de üretim kapısındadır", () => {
    regime = { productionEnabled: false };
    renderAt("/operations/work-orders/abc-123", "/operations/work-orders/:id", "workorder:read");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("izin kapısı modül kapısından ÖNCE: izinsiz kullanıcı modül açık olsa da /forbidden", () => {
    permissions = ["item:read"];
    regime = { dokumaEnabled: true };
    renderAt("/operations/weaving-orders", "/operations/weaving-orders", "weavingorder:read");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });
});
