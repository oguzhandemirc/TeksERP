// =============================================================================
// BEKÇİ — fatura formu KDV/tevkifat ön değeri (D4-V1k) ÖNBELLEK DOLUYKEN de uygulanır
// =============================================================================
// ⭐ Form ikinci kez açıldığında `tax-defaults` sorgusu React Query önbelleğindedir ve ilk render'da DOLU gelir.
//    Uygulanan-değer tabanı satırların kurulduğu değer ({genel KDV, 0}) olmazsa ön değer hiç uygulanmaz,
//    sonra seçilen müşterinin değeri de "elle değiştirilmiş" sayılıp atlanırdı (inceleme bulgusu, PR #359).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { screen, fireEvent, waitFor, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const getInvoiceTaxDefaults = vi.fn();
const getCariByCustomer = vi.fn();

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    getInvoiceTaxDefaults: (...a: unknown[]) => getInvoiceTaxDefaults(...a),
    getCariByCustomer: (...a: unknown[]) => getCariByCustomer(...a),
  };
});
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: () => <div data-testid="ref-select" />,
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("cus-1")}>Cari seç (stub)</button>
  ),
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled: true, financeDefaultVatRate: 20 } } }),
}));
vi.mock("@/pages/Customers/service", () => ({ customerService: { getById: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getById: vi.fn() } }));
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: vi.fn() } }));

import { InvoiceFormDialog } from "./InvoiceFormDialog";

const GENERAL = { vatRate: 20, withholdingRate: 50 };
const CUSTOMER = { vatRate: 10, withholdingRate: 70 };

/** Önceki açılıştan kalmış önbellek: genel ön değer (müşterisiz SALES) zaten DOLU. */
function renderWithWarmCache() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["finance", "invoice-tax-defaults", "SALES", null], GENERAL);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<InvoiceFormDialog open onOpenChange={() => {}} onCreated={() => {}} />, { wrapper: Wrapper });
}

/** Satırdaki sayı alanlarının değerleri (diyalog PORTAL'da — container kapsamaz). */
const numberValues = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]')).map((i) => i.value);

beforeEach(() => {
  vi.clearAllMocks();
  getCariByCustomer.mockResolvedValue(null);
  getInvoiceTaxDefaults.mockImplementation(async (_t: string, customerId: string | null) =>
    customerId === "cus-1" ? CUSTOMER : GENERAL,
  );
});

describe("yeni fatura — KDV/tevkifat ön değeri, önbellek dolu", () => {
  it("⭐ genel 5/10 önbellekteyken form açılınca satır tevkifatı 50 gelir", async () => {
    renderWithWarmCache();
    await waitFor(() => expect(numberValues()).toContain("50"));
    expect(numberValues()).toContain("20");
  });

  it("⭐ ardından müşteri seçilince müşterinin KDV/tevkifatı satıra gelir", async () => {
    renderWithWarmCache();
    await waitFor(() => expect(numberValues()).toContain("50"));
    fireEvent.click(screen.getByText("Cari seç (stub)"));
    await waitFor(() => expect(numberValues()).toContain("70"));
    expect(numberValues()).toContain("10");
    expect(numberValues()).not.toContain("50");
  });
});
