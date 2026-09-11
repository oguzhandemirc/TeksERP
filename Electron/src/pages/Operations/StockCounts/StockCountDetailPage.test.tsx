// =============================================================================
// BEKÇİ — sayım kâğıdının OKUTMA ve YAZMA YÜZEYİ
// =============================================================================
// Saf katman (`stockCountRules`) "hangi karar doğru"yu ölçüyor; burada ölçülen
// şey o kararın EKRANA BAĞLI olup olmadığı:
//   ① Listede olmayan barkod SESSİZ GEÇMEZ ve satır işaretlemez (fazla/yabancı
//      top sayımla eklenmez).
//   ② Listedeki barkod tek okutmada "bulundu" yazar.
//   ③ TASLAK OLMAYAN sayımda yazma yüzeyi HİÇ ÇİZİLMEZ (kapalı kâğıtta işaret
//      kutusu görmek "hâlâ düzeltebilirim" vaadidir; her tıklama 409 döner).
//   ④ Yazma yetkisi yoksa da çizilmez (backend zaten reddeder — ekran önceden
//      söyler).
//
// NEGATİF SONDA (2026-08-15, 2 sonda; dosya `shasum` ile geri yüklendi):
//   ① `submitScan`in `unknown` dalı `markM.mutate` çağıracak şekilde
//      değiştirildi                                          → 1 kontrol düştü
//   ② okutma şeridinin `canWrite` koşulu `isDraft`e gevşetildi → 1 düştü
// =============================================================================
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { StockCountDetail } from "./service";

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "sc-1" }),
}));

// PageHeader chrome'u (favoriler → PreferencesProvider) bu testin konusu değil;
// aksiyonlar ve başlık eki AYNEN çizilir (GoodsReceiptsPage.test emsali).
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions, titleExtra }: { title: string; actions?: ReactNode; titleExtra?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {titleExtra}
      {actions}
    </div>
  ),
}));

vi.mock("@/components/print/PrintedDocDialog", () => ({ PrintedDocDialog: () => null }));

const warning = vi.fn();
const success = vi.fn();
const info = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    warning: (...a: unknown[]) => warning(...a),
    success: (...a: unknown[]) => success(...a),
    info: (...a: unknown[]) => info(...a),
    error: vi.fn(),
  },
}));

const getStockCount = vi.fn();
const markStockCountLine = vi.fn();
const markAllFound = vi.fn();
vi.mock("./service", () => ({
  getStockCount: (...a: unknown[]) => getStockCount(...a),
  markStockCountLine: (...a: unknown[]) => markStockCountLine(...a),
  markAllFound: (...a: unknown[]) => markAllFound(...a),
  completeStockCount: vi.fn(),
  cancelStockCount: vi.fn(),
}));

import { StockCountDetailPage } from "./StockCountDetailPage";

function detail(status: StockCountDetail["status"] = "DRAFT"): StockCountDetail {
  return {
    id: "sc-1",
    countNo: "SAY1508260001",
    status,
    notes: null,
    createdAt: "2026-08-15T08:00:00Z",
    completedAt: status === "COMPLETED" ? "2026-08-15T12:00:00Z" : null,
    cancelledAt: null,
    cancelReason: null,
    reversedAt: null,
    reverseReason: null,
    warehouse: { id: "w1", code: "MRK", name: "Merkez" },
    lines: [
      {
        id: "l1",
        kind: "ROLL",
        expectedQty: "100",
        countedQty: null,
        found: null,
        notes: null,
        outOfScopeReason: null,
        roll: {
          id: "r1",
          barcode: "R-101",
          status: "WAREHOUSE",
          width: null,
          item: { name: "Süprem" },
          color: { name: "Siyah" },
        },
        item: null,
      },
    ],
  };
}

describe("StockCountDetailPage — okutma", () => {
  beforeEach(() => {
    getStockCount.mockResolvedValue(detail());
    markStockCountLine.mockResolvedValue({ data: { id: "l1" } });
    markAllFound.mockResolvedValue({ data: { updated: 0 } });
    useAuthStore.getState().setUser({
      userId: "u1",
      username: "depo",
      permissions: ["warehouse:read", "warehouse:transfer"],
    });
  });

  it("listedeki barkod tek okutmada “bulundu” yazar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockCountDetailPage />);
    const box = await screen.findByPlaceholderText(/Barkod okut/);

    await user.type(box, "r-101{Enter}");

    await waitFor(() =>
      expect(markStockCountLine).toHaveBeenCalledWith("sc-1", "l1", { found: true }),
    );
  });

  it("⭐ listede OLMAYAN barkod satır işaretlemez, uyarı basar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockCountDetailPage />);
    const box = await screen.findByPlaceholderText(/Barkod okut/);

    await user.type(box, "R-999{Enter}");

    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(markStockCountLine).not.toHaveBeenCalled();
    // Uyarı NE YAPILACAĞINI da söyler — "bulunamadı" tek başına çıkmaz sokak.
    expect(String(warning.mock.calls[0]?.[0])).toMatch(/transfer|mal kabul/i);
  });

  it("okutma kutusu her okutmadan sonra temizlenir (seri okutma)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<StockCountDetailPage />);
    const box = await screen.findByPlaceholderText(/Barkod okut/);
    await user.type(box, "R-101{Enter}");
    await waitFor(() => expect(box).toHaveValue(""));
  });
});

describe("StockCountDetailPage — yazma yüzeyinin kapıları", () => {
  beforeEach(() => {
    markStockCountLine.mockResolvedValue({ data: { id: "l1" } });
    markAllFound.mockResolvedValue({ data: { updated: 0 } });
  });

  it("⭐ TAMAMLANMIŞ sayımda okutma ve işaret yüzeyi HİÇ çizilmez", async () => {
    getStockCount.mockResolvedValue(detail("COMPLETED"));
    useAuthStore.getState().setUser({
      userId: "u1",
      username: "depo",
      permissions: ["warehouse:read", "warehouse:transfer", "roll:manual-adjust", "yarn:write"],
    });
    renderWithProviders(<StockCountDetailPage />);

    // Satırlar okunur (kâğıt görünür), yazma yüzeyi yok.
    expect(await screen.findByText("R-101")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Barkod okut/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bulundu: / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Tamamla$/ })).not.toBeInTheDocument();
  });

  it("⭐ `warehouse:transfer` yoksa taslakta bile yazma yüzeyi çizilmez", async () => {
    getStockCount.mockResolvedValue(detail());
    useAuthStore.getState().setUser({ userId: "u2", username: "okur", permissions: ["warehouse:read"] });
    renderWithProviders(<StockCountDetailPage />);

    expect(await screen.findByText("R-101")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Barkod okut/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Eksik: / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hepsi Bulundu/ })).not.toBeInTheDocument();
  });

  it("taslak + yetki: satır işaret düğmeleri ve “Hepsi Bulundu” çizilir", async () => {
    getStockCount.mockResolvedValue(detail());
    useAuthStore.getState().setUser({
      userId: "u1",
      username: "depo",
      permissions: ["warehouse:read", "warehouse:transfer"],
    });
    renderWithProviders(<StockCountDetailPage />);

    expect(await screen.findByRole("button", { name: "Bulundu: R-101" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eksik: R-101" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hepsi Bulundu \(1\)/ })).toBeInTheDocument();
  });

  it("⭐ TAMAMLA düğmesi iki izni birden ister (roll:manual-adjust + yarn:write)", async () => {
    getStockCount.mockResolvedValue(detail());
    useAuthStore.getState().setUser({
      userId: "u3",
      username: "yarim",
      permissions: ["warehouse:read", "warehouse:transfer", "roll:manual-adjust"],
    });
    renderWithProviders(<StockCountDetailPage />);

    await screen.findByText("R-101");
    // Tek izinle düğme ÇİZİLMEZ — backend `complete` ucu iki middleware zinciri
    // uyguluyor; çizilseydi kullanıcı tıklar ve 403 alırdı.
    expect(screen.queryByRole("button", { name: /^Tamamla$/ })).not.toBeInTheDocument();
  });
});
