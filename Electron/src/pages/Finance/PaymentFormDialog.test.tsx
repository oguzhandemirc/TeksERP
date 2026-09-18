// =============================================================================
// BEKÇİ — Yeni Tahsilat/Ödeme: açık faturalar aynı pencerede (2026-09-18)
// =============================================================================
//   §1 cari + kasa seçilince açık faturalar listelenir (uç MÜŞTERİ KARTIYLA sorulur, hesap değil)
//   §2 satırdaki "Tümü" → taslak + tutar ÖN-DOLAR; Kaydet → createPayment SONRA allocateBulk (paymentId + kalem)
//   §3 seçim yoksa ödeme bugünkü gibi bağsız: allocateBulk ÇAĞRILMAZ
//   §4 eşlenen > tutar → Kaydet kilitli, sebep yazılı
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const createPayment = vi.fn();
const listOpenInvoices = vi.fn();
const allocateBulk = vi.fn();
vi.mock("./service", async (orig) => {
  const m = await orig<typeof import("./service")>();
  return {
    ...m,
    createPayment: (...a: unknown[]) => createPayment(...a),
    listCashBoxes: () => Promise.resolve({ data: [{ id: "k1", name: "Ana Kasa", currency: "TRY", isActive: true }] }),
    listBankAccounts: () => Promise.resolve({ data: [] }),
  };
});
vi.mock("./Allocations/service", async (orig) => {
  const m = await orig<typeof import("./Allocations/service")>();
  return { ...m, listOpenInvoices: (...a: unknown[]) => listOpenInvoices(...a), allocateBulk: (...a: unknown[]) => allocateBulk(...a) };
});
// Cari seçici: gerçek modal yerine tek düğme (seçim → customerId).
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("cust-1")}>Cari seç (stub)</button>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { PaymentFormDialog } from "./PaymentFormDialog";

const ROWS = { data: [{ id: "inv-1", docNo: "F-1", type: "SALES", currency: "TRY", issueDate: "2026-09-01", dueDate: "2026-09-10", effectiveDueDate: "2026-09-10", grandTotal: "1000.00", paidTotal: "300.00", openTotal: "700.00" }], totalOpen: "700.00" };

async function setup() {
  const user = userEvent.setup();
  renderWithProviders(<PaymentFormDialog open direction="IN" onOpenChange={() => {}} onCreated={() => {}} />);
  await user.click(screen.getByText("Cari seç (stub)"));
  const select = await screen.findByLabelText("Kasa / Banka");
  await waitFor(() => expect(screen.getByRole("option", { name: /Ana Kasa/ })).toBeInTheDocument());
  fireEvent.change(select, { target: { value: "k1" } });
  return user;
}

beforeEach(() => {
  createPayment.mockReset();
  listOpenInvoices.mockReset();
  allocateBulk.mockReset();
  listOpenInvoices.mockResolvedValue(ROWS);
  createPayment.mockResolvedValue({ success: true, data: { id: "pay-1", docNo: "T-1" }, message: "Kaydedildi." });
  allocateBulk.mockResolvedValue({ message: "ok" });
});

describe("PaymentFormDialog — açık faturalar", () => {
  it("§1 cari + kasa → liste müşteri kartıyla istenir ve fatura satırı görünür", async () => {
    await setup();
    await waitFor(() => expect(listOpenInvoices).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cust-1", currency: "TRY", direction: "IN" })));
    expect(await screen.findByText("F-1")).toBeInTheDocument();
    expect(screen.getByTestId("odeme-eslenen")).toHaveTextContent(/bağlanmadan kaydedilir/);
  });

  it("§2 ⭐ 'Tümü' → tutar ön-dolar (700); Kaydet → createPayment, sonra allocateBulk(paymentId, kalem)", async () => {
    const user = await setup();
    await screen.findByText("F-1");
    await user.click(screen.getByRole("button", { name: /^Tümü$/ }));
    await waitFor(() => expect(screen.getByTestId("odeme-eslenen")).toHaveTextContent(/Eşlenen/));
    await user.click(screen.getByRole("button", { name: /Tahsilat Kaydet/ }));
    await waitFor(() => expect(allocateBulk).toHaveBeenCalledWith({ paymentId: "pay-1", items: [{ invoiceId: "inv-1", amount: "700.00" }] }));
    expect(createPayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 700, customerId: "cust-1", cashBoxId: "k1" }));
    expect(createPayment.mock.invocationCallOrder[0]!).toBeLessThan(allocateBulk.mock.invocationCallOrder[0]!);
  });

  it("§3 seçim yok → bağsız ödeme, allocateBulk çağrılmaz (bugünkü davranış)", async () => {
    const user = await setup();
    await screen.findByText("F-1");
    fireEvent.change(screen.getByLabelText("Tutar"), { target: { value: "150" } });
    await user.click(screen.getByRole("button", { name: /Tahsilat Kaydet/ }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    expect(allocateBulk).not.toHaveBeenCalled();
  });

  it("§4 eşlenen > tutar → Kaydet kilitli, sebep yazılı (tutar değişince liste EKRANDA KALIR)", async () => {
    const user = await setup();
    await screen.findByText("F-1");
    fireEvent.change(screen.getByLabelText("Tutar"), { target: { value: "100" } });
    // tutar elle yazıldı (100) → "Tümü" kalanı yazar (100), engel yok; taslağı elle 700'e çek → engel
    await user.click(screen.getByRole("button", { name: /^Tümü$/ }));
    const draftInput = await screen.findByDisplayValue("100.00");
    expect(screen.queryByTestId("odeme-engel")).toBeNull();
    fireEvent.change(draftInput, { target: { value: "700" } });
    await waitFor(() => expect(screen.getByTestId("odeme-engel")).toHaveTextContent(/aşıyor/));
    expect(screen.getByRole("button", { name: /Tahsilat Kaydet/ })).toBeDisabled();
  });
});
