// BEKÇİ — Tahsilat/Ödeme listesi, tek yazar (2026-09-18): "Kasa defteri" sütunu ödemenin KH satırını gösterir ve Kasa
//   Hareketleri'ne arama ile gider; satırı olmayan (backfill öncesi) ödemede "—" + ipucu; `?search=` URL tohumu sorguya iner.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const listPayments = vi.fn();
const opened: string[] = [];
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), listPayments: (...a: unknown[]) => listPayments(...a) }));
vi.mock("./PaymentFormDialog", () => ({ PaymentFormDialog: () => null }));
vi.mock("./PaymentsFilterBar", () => ({ PaymentsFilterBar: () => null }));
vi.mock("@/components/print/PrintedDocDialog", () => ({ PrintedDocDialog: () => null }));
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: (to: string) => ({ onClick: () => opened.push(to), onAuxClick: () => {}, onContextMenu: () => {} }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
import { PaymentsPage } from "./PaymentsPage";

const row = (id: string, docNo: string, cashTransaction: { id: string; docNo: string; txnDate: string; status: "ACTIVE" | "CANCELLED" } | null) => ({ id, docNo, direction: "IN", method: "CASH", status: "ACTIVE", currency: "TRY", amount: 100, amountTry: 100, paymentDate: "2026-09-18T08:00:00Z", reference: null, cashBox: { id: "k1", name: "Ana Kasa" }, bankAccount: null, cari: { id: "c1", customer: { code: "M1", name: "Müşteri A" }, subcontractor: null }, cashTransaction });

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><PaymentsPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { listPayments.mockReset().mockResolvedValue({ data: [row("p1", "TH-1", { id: "x", docNo: "KH-9", txnDate: "2026-09-18", status: "ACTIVE" }), row("p2", "TH-2", null)], pagination: { total: 2, totalPages: 1 } }); opened.length = 0; });

describe("PaymentsPage — kasa defteri sütunu", () => {
  it("⭐ satırlı ödeme KH no gösterir ve Kasa Hareketleri'ne arama ile gider; satırsız ödemede —", async () => {
    const user = userEvent.setup();
    renderAt("/finance/payments");
    const link = await screen.findByTitle("Kasa defteri satırını aç");
    expect(link).toHaveTextContent("KH-9");
    await user.click(link);
    expect(opened).toEqual(["/finance/cash-transactions?search=KH-9"]);
    expect(screen.getByTitle(/Defter satırı yok/)).toBeInTheDocument();
  });
  it("?search= tohumu ilk sorguya iner", async () => {
    renderAt("/finance/payments?search=TH-77");
    await waitFor(() => expect(listPayments).toHaveBeenCalledWith(expect.objectContaining({ search: "TH-77" })));
  });
});
