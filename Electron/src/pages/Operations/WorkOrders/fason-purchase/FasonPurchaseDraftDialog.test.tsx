// BEKÇİ — fason kabulünden alış faturası taslağı (F6 panel yarısı): sevkin kabulü iş emri kabullerinden numarayla
// eşlenir; önizleme sunucudan; mevcut fatura / bağsız tedarikçi oluşturmayı kilitler; önizleme hatası satır içinde.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const { FasonPurchaseDraftDialog } = await import("./FasonPurchaseDraftDialog");
const { canCreatePurchaseDraft } = await import("./service");

const PREVIEW = {
  receiptId: "rc2", receiptNo: "FK-002", subcontractor: { id: "f1", name: "Boyacı A" }, supplierCustomerId: "cust1", currency: "TRY",
  lines: [{ serviceItemId: "s1", description: "Boya hizmeti", qty: "180", unit: "METER", unitPrice: "4.5", currency: "TRY", finishingRateId: "fr1", vatRate: 20, withholdingRate: 0 }],
  subtotal: "810", existingInvoice: null, warnings: ["Tarife sevk tarihinden"],
};
const DISPATCH = { dispatchNo: "FS-9", subcontractorName: "Boyacı A", receipts: [{ receiptNo: "FK-002" }] };

beforeEach(() => {
  get.mockReset().mockImplementation((url: string) =>
    url === "/api/subcontractor/receipts"
      ? Promise.resolve({ data: { data: [{ id: "rc1", receiptNo: "FK-001", receivedAt: "2026-11-01T10:00:00Z" }, { id: "rc2", receiptNo: "FK-002", receivedAt: "2026-11-03T10:00:00Z" }] } })
      : Promise.resolve({ data: { data: PREVIEW } }),
  );
  post.mockReset().mockResolvedValue({ data: { data: { id: "inv1", docNo: "AF-1" } } });
});

describe("FasonPurchaseDraftDialog", () => {
  it("⭐ sevkin kabulü numarayla bulunur, önizleme o kabul için, taslak POST aynı kabule", async () => {
    renderWithProviders(<FasonPurchaseDraftDialog workOrderId="w1" dispatch={DISPATCH} onClose={() => {}} />);
    await screen.findByText("Boya hizmeti");
    expect(get).toHaveBeenCalledWith("/api/subcontractor/receipts", { params: { workOrderId: "w1", pageSize: "100" } });
    expect(get).toHaveBeenCalledWith("/api/finance/invoices/from-subcontractor-receipt/rc2/preview", { suppressErrorToast: true });
    expect(screen.getByText("Tarife sevk tarihinden")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Taslağı oluştur/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/finance/invoices/from-subcontractor-receipt/rc2", {}));
  });

  it("⭐ mevcut fatura varsa oluşturma kilitli ve söylenir", async () => {
    get.mockImplementation((url: string) =>
      url === "/api/subcontractor/receipts"
        ? Promise.resolve({ data: { data: [{ id: "rc2", receiptNo: "FK-002", receivedAt: "2026-11-03T10:00:00Z" }] } })
        : Promise.resolve({ data: { data: { ...PREVIEW, existingInvoice: { id: "i", docNo: "AF-7", status: "CONFIRMED" } } } }),
    );
    renderWithProviders(<FasonPurchaseDraftDialog workOrderId="w1" dispatch={DISPATCH} onClose={() => {}} />);
    expect(await screen.findByText("AF-7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Taslağı oluştur/ })).toBeDisabled();
  });

  it("önizleme 409 (bağsız firma) satır içinde, buton kilitli", async () => {
    const err = Object.assign(new Error("409"), { isAxiosError: true, response: { status: 409, data: { message: "Fason firma bir cari karta bağlı değil" } } });
    get.mockImplementation((url: string) =>
      url === "/api/subcontractor/receipts"
        ? Promise.resolve({ data: { data: [{ id: "rc2", receiptNo: "FK-002", receivedAt: "2026-11-03T10:00:00Z" }] } })
        : Promise.reject(err),
    );
    renderWithProviders(<FasonPurchaseDraftDialog workOrderId="w1" dispatch={DISPATCH} onClose={() => {}} />);
    expect(await screen.findByText(/Önizleme okunamadı|cari karta bağlı değil/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Taslağı oluştur/ })).toBeDisabled();
  });

  it("canCreatePurchaseDraft: satırsız / tedarikçisiz / faturalı ⇒ false", () => {
    expect(canCreatePurchaseDraft(PREVIEW as never)).toBe(true);
    expect(canCreatePurchaseDraft({ ...PREVIEW, supplierCustomerId: null } as never)).toBe(false);
    expect(canCreatePurchaseDraft({ ...PREVIEW, lines: [] } as never)).toBe(false);
    expect(canCreatePurchaseDraft({ ...PREVIEW, existingInvoice: { id: "i", docNo: "AF-7", status: "DRAFT" } } as never)).toBe(false);
    expect(canCreatePurchaseDraft(undefined)).toBe(false);
  });
});
