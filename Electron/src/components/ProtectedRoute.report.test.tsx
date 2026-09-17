// =============================================================================
// PANEL ROUTE RAPOR KAPISI — davranış bekçisi (Raporlar K5, üç yolun ikincisi)
// =============================================================================
// Süperadminin kapattığı rapor, izni olan kullanıcıya adres çubuğundan da açılmaz:
// `ProtectedRoute` izin ve modül kapısından SONRA `isReportOpen(key)` sorar; kapalı →
// /forbidden. Gerçek `useOperationsVisibilityContext` KULLANILIR (sahte değil): karar
// ctx'te alınır, bekçi de o karardan geçer — `reportsClosedKeys` bayrak yanıtından gelir.
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `ProtectedRoute`tan rapor
// bloğu silindi → §1 ❌ (kapalı rapor çizildi); `isReportOpenWith` bilinmeyen anahtarı açık saydı → §3 ❌.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { ProtectedRoute } from "./ProtectedRoute";

let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p) || permissions.includes("admin:*"),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)) || permissions.includes("admin:*"),
  }),
}));

/** Bayrak yanıtı — gerçek ctx hook'u bunu okur. `reportsClosedKeys` sondaların çevirdiği tek düğme. */
let flags: Record<string, unknown> = {};
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: flags }, isSuccess: true, isError: false }),
  useShipmentConfirmationEnabled: () => false,
}));
vi.mock("@/pages/Operations/SackStore/service", () => ({ sackStoreService: {} }));

vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      user: { permissions: ["item:read"] },
      isHydrated: true,
      isSystemAccount: false,
      systemAccountExists: false,
    }),
}));

const OPEN_KEY = "sales/order-intake";
const OPEN_PATH = `/reports/${OPEN_KEY}`;
const PERM = REPORT_CATALOG.find((r) => r.key === OPEN_KEY)!.izin;

function renderAt(path: string, routePath: string, perm: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forbidden" element={<div>FORBIDDEN-SAYFASI</div>} />
        <Route
          path={routePath}
          element={
            <ProtectedRoute requirePermission={perm}>
              <div>RAPOR-ICERIGI</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute — rapor kapısı", () => {
  beforeEach(() => {
    permissions = ["admin:*"];
    flags = { productionEnabled: true, financeEnabled: true, reportsClosedKeys: [] };
  });

  it("§1 ⭐ KAPALI rapor + izin VAR + URL → /forbidden", () => {
    flags = { ...flags, reportsClosedKeys: [OPEN_KEY] };
    renderAt(OPEN_PATH, OPEN_PATH, PERM);
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
    expect(screen.queryByText("RAPOR-ICERIGI")).toBeNull();
  });

  it("§2 ⭐ AÇIK rapor → çizilir (boş liste = hepsi açık, bugünkü davranış)", () => {
    renderAt(OPEN_PATH, OPEN_PATH, PERM);
    expect(screen.getByText("RAPOR-ICERIGI")).toBeInTheDocument();
  });

  it("§3 ⭐ BİLİNMEYEN anahtar → kapalı (katalogda olmayan yaprak yolu /forbidden)", () => {
    renderAt("/reports/sales/olmayan-rapor", "/reports/sales/olmayan-rapor", PERM);
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("§4 ⭐ liste OKUNAMADI (null) → her rapor kapalı; kategori hub'ı rapor değildir, çizilir", () => {
    flags = { ...flags, reportsClosedKeys: null };
    renderAt(OPEN_PATH, OPEN_PATH, PERM);
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("§4b kategori hub'ı (/reports/sales) rapor anahtarı taşımaz — liste null olsa da çizilir", () => {
    flags = { ...flags, reportsClosedKeys: null };
    renderAt("/reports/sales", "/reports/sales", PERM);
    expect(screen.getByText("RAPOR-ICERIGI")).toBeInTheDocument();
  });

  it("§5 alt yol ebeveyn rapora katlanır: /reports/production/batch-trace/:id de aynı kapıdadır", () => {
    flags = { ...flags, reportsClosedKeys: ["production/batch-trace"] };
    renderAt("/reports/production/batch-trace/abc", "/reports/production/batch-trace/:batchId", "report:production");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("§6 izin kapısı ÖNCE: izinsiz kullanıcı rapor açık olsa da /forbidden", () => {
    permissions = ["item:read"];
    renderAt(OPEN_PATH, OPEN_PATH, PERM);
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });

  it("§7 modül kapısı rapor kapısından ÖNCE ve bağımsız: modül kapalıyken açık listede olsa da /forbidden", () => {
    flags = { ...flags, financeEnabled: false, reportsClosedKeys: [] };
    renderAt("/reports/finance/aging", "/reports/finance/aging", "report:finance");
    expect(screen.getByText("FORBIDDEN-SAYFASI")).toBeInTheDocument();
  });
});
