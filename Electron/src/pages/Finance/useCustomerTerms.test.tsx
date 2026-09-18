// BEKÇİ — tek çözücü (Z-B ③): terimler by-customer'dan (kod araması YOK); 404 → termDays/defaultCurrency null ve settled; SUBCONTRACTOR'da hesap aranmaz
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const getCariByCustomer = vi.fn(); const listCari = vi.fn(); const getCustomerById = vi.fn(); const getSubById = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), getCariByCustomer: (...a: unknown[]) => getCariByCustomer(...a), listCari: (...a: unknown[]) => listCari(...a) }));
vi.mock("@/pages/Customers/service", () => ({ customerService: { getById: (...a: unknown[]) => getCustomerById(...a) } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getById: (...a: unknown[]) => getSubById(...a) } }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { financeEnabled: true } } }) }));
import { useCustomerTerms, type TermsParty } from "./useCustomerTerms";

function Probe({ party, id }: { party: TermsParty; id: string | null }) {
  const t = useCustomerTerms(party, id);
  return <pre data-testid="t">{JSON.stringify(t)}</pre>;
}
const read = () => JSON.parse(screen.getByTestId("t").textContent ?? "{}");

beforeEach(() => { vi.clearAllMocks(); getCustomerById.mockResolvedValue({ data: { id: "cus-1", code: "MUS-1", name: "ARZU" } }); getSubById.mockResolvedValue({ data: { id: "sub-1", code: "FSN-1", name: "BOYA" } }); });

describe("useCustomerTerms", () => {
  it("⭐ müşteri: by-customer(id) → vade + para birimi; kod araması (listCari) HİÇ çağrılmaz", async () => {
    getCariByCustomer.mockResolvedValue({ id: "c1", paymentTermDays: 30, defaultCurrency: "USD", balances: [] });
    renderWithProviders(<Probe party="CUSTOMER" id="cus-1" />);
    await waitFor(() => expect(read().settled).toBe(true));
    expect(read()).toMatchObject({ partyName: "ARZU — MUS-1", termDays: 30, defaultCurrency: "USD", hasAccount: true });
    expect(getCariByCustomer).toHaveBeenCalledWith("cus-1");
    expect(listCari).not.toHaveBeenCalled();
  });
  it("⭐ hesap yok (404 → null): öneri yok, settled TRUE (alan boş kalır, uydurulmaz)", async () => {
    getCariByCustomer.mockResolvedValue(null);
    renderWithProviders(<Probe party="CUSTOMER" id="cus-1" />);
    await waitFor(() => expect(read().settled).toBe(true));
    expect(read()).toMatchObject({ termDays: null, defaultCurrency: null, hasAccount: false });
  });
  it("eski fason taraf: ad gelir, hesap aranmaz", async () => {
    renderWithProviders(<Probe party="SUBCONTRACTOR" id="sub-1" />);
    await waitFor(() => expect(read().settled).toBe(true));
    expect(read()).toMatchObject({ partyName: "BOYA — FSN-1", termDays: null, hasAccount: null });
    expect(getCariByCustomer).not.toHaveBeenCalled();
  });
  it("taraf seçilmemiş: hiçbir sorgu yok, settled false", () => {
    renderWithProviders(<Probe party="CUSTOMER" id={null} />);
    expect(read().settled).toBe(false);
    expect(getCariByCustomer).not.toHaveBeenCalled();
  });
});
