// =============================================================================
// BEKÇİ — Mal kabul formu: SİPARİŞ SEÇİLİYKEN TEDARİKÇİ KİLİDİ (kullanıcı testi C2, 2026-09-17)
// =============================================================================
// Bölüm "Tedarikçi siparişten alındı: X — farklı olamaz" derken alt alan tıklanabilir + × temizlenebilirdi.
// Sipariş seçiliyken: etiket "Tedarikçi (siparişten)", tetik disabled, × yok; "Siparişsiz"e dönünce serbest.
// Negatif sonda: formda `disabled={createM.isPending}`e dönülünce (kilit düşer) ① ❌; `SupplierSelect`te × koşulundan
// `!disabled` kaldırılınca ② ❌.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
// TİP-ONLY import — `vi.mock` fabrikaları hoist edilir, değer taşıyan import'a
// dokunamaz; tip silindiği için burada güvenlidir.
import type { DraftLine } from "./ReceiptLineRows";

// Rejim bayrağı + yetki: iki iddiayı da kurabilmek için değişken.
let financeEnabled = true;
let canReadPurchaseOrders = true;


vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled } } }),
  // C8: lot zorunluluğu bu testlerin konusu değil — KAPALI (bugünkü davranış); ayrı bekçi `GoodsReceiptFormDialog.lotRequired.test`.
  useDevereLotRequired: () => false,
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => canReadPurchaseOrders,
    hasAnyPermission: () => canReadPurchaseOrders,
    hasAllPermissions: () => canReadPurchaseOrders,
  }),
}));

// Toast metni B5'in TEK yüzeyi — mesajın içeriği ölçülüyor.
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Formun ağır çocukları — bu testin konusu değil (kendi bekçileri var).
vi.mock("./ReceiptImportButton", () => ({ ReceiptImportButton: () => null }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));
// Bu dosyada `SupplierSelect` GERÇEKTİR (kilit ölçülüyor); yalnız servisleri sahte.
// `restoreMocks: true` (vitest.config) her testten önce fabrikadaki implementasyonu siler → beforeEach'te kurulur.
const getCustomerById = vi.fn();
vi.mock("@/pages/Customers/service", () => ({ customerService: { listCursor: vi.fn(), getAll: vi.fn(), getById: (...a: unknown[]) => getCustomerById(...a) } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: vi.fn(), getById: vi.fn() } }));
vi.mock("./ReceiptLineRows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ReceiptLineRows")>();
  // Saf yardımcılar (emptyLine/expandLines/receiptTotals) GERÇEK kalır — form
  // onlarla çalışıyor. Editörün yerine tek düğme: "kaydedilebilir bir satır
  // girildi" olayını taklit eder (hücre hücre yazmak bu testin konusu değil).
  return {
    ...actual,
    ReceiptLineRows: ({
      lines,
      onChange,
    }: {
      lines: DraftLine[];
      onChange: (lines: DraftLine[]) => void;
    }) => (
      <div>
        <span data-testid="satir-sayisi">{lines.length}</span>
        <button
          type="button"
          onClick={() =>
            onChange([{ ...actual.emptyLine(), itemId: "item-1", initialQty: 100, count: 1 }])
          }
        >
          stub-satır-gir
        </button>
      </div>
    ),
  };
});

const createGoodsReceipt = vi.fn();
vi.mock("./service", () => ({
  createGoodsReceipt: (...a: unknown[]) => createGoodsReceipt(...a),
}));
vi.mock("./useItemTypes", () => ({
  useItemTypes: () => new Map<string, string>(),
  yarnIdsFrom: () => new Set<string>(),
}));
vi.mock("@/hooks/useWarehouses", () => ({
  useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [] }),
  useDefaultWarehouse: () => ({ id: "w1", code: "D1", name: "Merkez Depo" }),
  WAREHOUSES_QUERY_KEY: ["warehouses"],
}));
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn().mockRejectedValue(new Error("stub")), post: vi.fn() },
}));

// Alış siparişi uçları — saf yardımcılar (fmtQty/toNum) GERÇEK kalır, yoksa
// bölüm çizilirken patlar.
const listPurchaseOrders = vi.fn();
const getPurchaseOrder = vi.fn();
vi.mock("../PurchaseOrders/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../PurchaseOrders/service")>();
  return {
    ...actual,
    listPurchaseOrders: (...a: unknown[]) => listPurchaseOrders(...a),
    getPurchaseOrder: (...a: unknown[]) => getPurchaseOrder(...a),
  };
});

import { GoodsReceiptFormDialog } from "./GoodsReceiptFormDialog";

const TRIGGER = { name: "Tedarikçi seç (liste)" };

describe("GoodsReceiptFormDialog — sipariş seçiliyken tedarikçi kilidi", () => {
  beforeEach(() => {
    financeEnabled = true;
    canReadPurchaseOrders = true;
    getCustomerById.mockResolvedValue({ data: { id: "s1", code: "T1", name: "ARZU TEKSTİL" } });
    listPurchaseOrders.mockResolvedValue({
      data: [{ id: "po-1", orderNo: "AS1408260001", status: "OPEN", currency: "TRY", orderDate: "2026-08-14T00:00:00Z", expectedDate: null, supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" } }],
      pagination: { total: 1, totalPages: 1 },
    });
    getPurchaseOrder.mockResolvedValue({ id: "po-1", orderNo: "AS1408260001", status: "OPEN", currency: "TRY", supplier: { id: "s1", code: "T1", name: "ARZU TEKSTİL" }, lines: [] });
  });

  it("⭐ ① sipariş seçilince: etiket 'Tedarikçi (siparişten)', tetik DISABLED, × YOK; değer siparişin tedarikçisi", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByText("Tedarikçi (opsiyonel)")).toBeInTheDocument();
    expect(screen.getByRole("button", TRIGGER)).not.toBeDisabled();
    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest("select") as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");
    expect(await screen.findByText(/Tedarikçi siparişten alındı/)).toBeInTheDocument();
    expect(screen.getByText("Tedarikçi (siparişten)")).toBeInTheDocument();
    expect(screen.queryByText("Tedarikçi (opsiyonel)")).toBeNull();
    const trigger = screen.getByRole("button", TRIGGER);
    expect(trigger).toBeDisabled();
    await vi.waitFor(() => expect(trigger).toHaveTextContent("ARZU TEKSTİL"));
    expect(screen.queryByRole("button", { name: "Tedarikçiyi temizle" })).toBeNull();
  });

  it("⭐ ② 'Siparişsiz'e dönünce tetik aktif, etiket opsiyonel; değer korunur ve × çizilir", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    const picker = (await screen.findByRole("option", { name: /AS1408260001/ })).closest("select") as HTMLSelectElement;
    await user.selectOptions(picker, "po-1");
    await screen.findByText(/Tedarikçi siparişten alındı/);
    await user.selectOptions(picker, "");
    await vi.waitFor(() => expect(screen.getByRole("button", TRIGGER)).not.toBeDisabled());
    expect(screen.getByText("Tedarikçi (opsiyonel)")).toBeInTheDocument();
    expect(screen.getByRole("button", TRIGGER)).toHaveTextContent("ARZU TEKSTİL");
    expect(screen.getByRole("button", { name: "Tedarikçiyi temizle" })).toBeInTheDocument();
  });
});
