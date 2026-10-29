// =============================================================================
// BEKÇİ — Kart formu "Finans" bölümü (Z-B ①): §1 finance:write yoksa salt-okunur · §2 düzenlemede hesabın terimleri tohumlanır +
//   açık bakiye · §3 hesap yok (404) → sakin cümle, alanlar boş · §4 yeni kartta bakiye yerine "kayıtla açılır"
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";

const getCariByCustomer = vi.fn();
vi.mock("@/pages/Finance/service", async (orig) => ({ ...(await orig<typeof import("@/pages/Finance/service")>()), getCariByCustomer: (...a: unknown[]) => getCariByCustomer(...a) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { financeEnabled: true, financeServiceBillingEnabled: true, financeServiceBillingTrigger: "PER_SHIPMENT" } } }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
import { CustomerFinanceSection } from "./CustomerFinanceSection";
import { financeFormDefaults } from "./customerFinance";

let lastForm: { getValues: (k: string) => unknown } | null = null;
function Host({ customerId, canWrite }: { customerId: string | null; canWrite: boolean }) {
  const form = useForm({ defaultValues: { ...financeFormDefaults } });
  lastForm = form as never;
  return <CustomerFinanceSection form={form as never} customerId={customerId} canWrite={canWrite} />;
}
const ACC = { id: "c1", kind: "CUSTOMER", code: "M1", name: "ARZU", paymentTermDays: 45, defaultCurrency: "EUR", taxOffice: "Kadıköy", riskLimit: "2500.00", isActive: true, balances: [{ currency: "EUR", balance: "1250.5" }, { currency: "TRY", balance: "0" }] };

beforeEach(() => { getCariByCustomer.mockReset().mockResolvedValue(ACC); });

describe("CustomerFinanceSection", () => {
  it("§1 ⭐ finance:write yoksa alanlar salt-okunur ve bunu söyler", async () => {
    renderWithProviders(<Host customerId="cus-1" canWrite={false} />);
    expect(screen.getByLabelText("Vade (gün)")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Para birimi")).toBeDisabled();
    expect(screen.getByText(/Salt okunur/)).toBeInTheDocument();
  });
  it("§2 ⭐ düzenlemede terimler hesaptan tohumlanır, açık bakiye sıfır olmayan para birimleriyle", async () => {
    renderWithProviders(<Host customerId="cus-1" canWrite />);
    await waitFor(() => expect(screen.getByLabelText("Vade (gün)")).toHaveValue(45));
    expect(screen.getByLabelText("Para birimi")).toHaveValue("EUR");
    expect(screen.getByLabelText("Vergi dairesi")).toHaveValue("Kadıköy");
    expect(screen.getByLabelText("Risk limiti")).toHaveValue("2500");
    expect(screen.getByTestId("customer-finance-balance")).toHaveTextContent(/Açık bakiye/);
    expect(screen.getByTestId("customer-finance-balance")).toHaveTextContent(/1\.250,50/);
    expect(getCariByCustomer).toHaveBeenCalledWith("cus-1");
  });
  it("§3 hesap yok (404 → null) → sakin cümle, alanlar boş, uydurma yok", async () => {
    getCariByCustomer.mockResolvedValue(null);
    renderWithProviders(<Host customerId="cus-2" canWrite />);
    await waitFor(() => expect(screen.getByTestId("customer-finance-balance")).toHaveTextContent(/cari hesabı henüz yok/));
    expect(screen.getByLabelText("Vade (gün)")).toHaveValue(null);
  });
  it("§4 yeni kartta hesap sorulmaz, 'kayıtla açılır' yazar", () => {
    renderWithProviders(<Host customerId={null} canWrite />);
    expect(screen.getByTestId("customer-finance-balance")).toHaveTextContent(/kaydedilince kendiliğinden açılır/);
    expect(getCariByCustomer).not.toHaveBeenCalled();
  });
  it("§5 ⭐ H8b hizmet faturası tetiği Finans → Cari ile aynı değeri gösterir; değişince form alanı yazılır", async () => {
    getCariByCustomer.mockResolvedValue({ ...ACC, serviceBillingTrigger: "PERIOD_END" });
    renderWithProviders(<Host customerId="cus-1" canWrite />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Dönem sonunda" })).toBeChecked());
    fireEvent.click(screen.getByRole("radio", { name: "Her sevkte" }));
    expect(lastForm?.getValues("financeServiceBillingTrigger")).toBe("PER_SHIPMENT");
    expect(lastForm?.getValues("financeServiceBillingTriggerSeed")).toBe("PERIOD_END");
  });
  it("§6 tetik null → 'Fabrika ayarı'; salt-okunurda seçenekler kapalı", async () => {
    getCariByCustomer.mockResolvedValue({ ...ACC, serviceBillingTrigger: null });
    renderWithProviders(<Host customerId="cus-1" canWrite={false} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Fabrika ayarı/ })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Her sevkte" })).toBeDisabled();
  });
  it("§7 fason hesabı ya da eski backend (alan yok) → tetik çizilmez", async () => {
    getCariByCustomer.mockResolvedValue({ ...ACC, kind: "SUBCONTRACTOR", serviceBillingTrigger: null });
    const r = renderWithProviders(<Host customerId="cus-1" canWrite />);
    await waitFor(() => expect(screen.getByLabelText("Vade (gün)")).toHaveValue(45));
    expect(screen.queryByTestId("cari-service-billing-trigger")).toBeNull();
    r.unmount();
    getCariByCustomer.mockResolvedValue(ACC);
    renderWithProviders(<Host customerId="cus-1" canWrite />);
    await waitFor(() => expect(screen.getByLabelText("Vade (gün)")).toHaveValue(45));
    expect(screen.queryByTestId("cari-service-billing-trigger")).toBeNull();
  });
  it("§8 yeni kart: fabrika ayarı seçili, değişmedikçe gövdeye girmez (tohum = değer)", () => {
    renderWithProviders(<Host customerId={null} canWrite />);
    expect(screen.getByRole("radio", { name: /Fabrika ayarı/ })).toBeChecked();
    expect(lastForm?.getValues("financeServiceBillingTriggerSeed")).toBe("FACTORY");
  });
});
