// =============================================================================
// BEKÇİ — "Yeni Sipariş" formu (sipariş formu ①②⑤): müşteri modalı (v3 müşteri kipi) açılır, satır seç → forma;
// Sipariş No otomatik/kilitli → tıkla yazılır → boş bırak → otomatik; 409 çakışması ALAN hatası; boyut sınıfı
// =============================================================================
// Negatif sonda (kırmızı görüldü): `OrderNumberField`te `onBlur` boş-dönüş dalı düşürülünce ② ❌;
// `DialogContent` `h-[88vh]` → `max-h-[85vh]` yapılınca kaynak taraması ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { OrderFormDialog } from "./OrderFormDialog";
import { ORDER_NUMBER_AUTO_PLACEHOLDER } from "./OrderNumberField";

vi.mock("@/hooks/usePricingEnabled", () => ({ usePricingEnabled: () => false, useCustomerBranchesEnabled: () => false }));
vi.mock("@/hooks/usePulseSync", () => ({ usePulseSync: () => false }));
vi.mock("@/services/featureFlagService", () => ({ currencyService: { list: vi.fn() } }));
// Kalem editörünün kendi bekçisi var (`OrderLinesEditor.test.tsx`); burada tek düğme geçerli bir satır girer.
vi.mock("./OrderLinesEditor", () => ({
  OrderLinesEditor: ({ onChange }: { onChange: (l: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ clientId: "l1", itemId: "i1", colorId: null, quantity: 10, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], cutNote: "" }])}>stub-satır-gir</button>
  ),
}));
vi.mock("@/pages/Customers/BranchSelect", () => ({ BranchSelect: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const listCursor = vi.fn();
const getById = vi.fn();
vi.mock("@/pages/Customers/service", () => ({ customerService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: vi.fn(), getById: (...a: unknown[]) => getById(...a), create: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: vi.fn(), getById: vi.fn() } }));
vi.mock("@/pages/Customers/CustomerFormDialog", () => ({ CustomerFormDialog: () => null }));
vi.mock("@/pages/Customers/schema", () => ({ customerCardPayload: () => ({}) }));

const CUSTOMERS = [
  { id: "c1", code: "MUS1", name: "Alfa Tekstil", isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, taxNumber: "111", contactPhone: "0212", city: "Bursa", isActive: true },
  { id: "c2", code: "MUS2", name: "Beta Hem Alır", isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: false, taxNumber: null, contactPhone: null, city: null, isActive: true },
];
const page = (data: unknown[]) => Promise.resolve({ success: true, data, pagination: { nextCursor: null, hasMore: false, limit: 50 } });

beforeEach(() => {
  listCursor.mockReset();
  getById.mockReset();
  // Rol modeli: müşteri kipi TEK bacak `isCustomerRole=true` (eski CUSTOMER→BOTH iki bacak kalktı); mock bayrakla süzer.
  listCursor.mockImplementation((p: { filters?: Record<string, string> }) => page(p.filters?.isCustomerRole === "true" ? CUSTOMERS.filter((c) => c.isCustomerRole) : CUSTOMERS));
  getById.mockImplementation((id: string) => Promise.resolve({ success: true, data: CUSTOMERS.find((c) => c.id === id) }));
});

const render = (onSubmit: (v: unknown) => Promise<void> = () => Promise.resolve()) =>
  renderWithProviders(<OrderFormDialog open onOpenChange={() => {}} onSubmit={onSubmit as never} />);

describe("OrderFormDialog — müşteri modalı (①)", () => {
  it("⭐ kutuya tıkla → 'Müşteri seç' modalı (müşteri kipi: CUSTOMER sonra BOTH bacağı, Şehir kolonu, Yeni müşteri); satır seç → kutu 'Ad — KOD'", async () => {
    render();
    await userEvent.click(screen.getByRole("button", { name: "Müşteri seç (liste)" }));
    const dialog = (await screen.findAllByRole("dialog")).find((d) => within(d).queryByText("Müşteri seç"))!;
    expect(dialog).toBeTruthy();
    await within(dialog).findByText("Alfa Tekstil");
    expect(within(dialog).getByText("Beta Hem Alır")).toBeInTheDocument();
    expect(within(dialog).getByText("Şehir")).toBeInTheDocument();
    expect(within(dialog).getByText("Bursa")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Yeni müşteri ekle" })).toBeInTheDocument();
    // sunucuya iki bacak: önce CUSTOMER, sonra BOTH; fason sorgusu YOK
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", isCustomerRole: "true" } })));
    for (const call of listCursor.mock.calls) expect((call[0] as { filters: Record<string, string> }).filters).not.toHaveProperty("type");
    const roleTrigger = within(dialog).getByRole("combobox", { name: "Yön" });
    await userEvent.click(roleTrigger);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Tümü", "Müşteri", "Müşteri + Tedarikçi"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(dialog).getByText("Alfa Tekstil"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Müşteri seç (liste)" })).toHaveTextContent("Alfa Tekstil — MUS1"));
  });
});

describe("OrderFormDialog — Sipariş No (②)", () => {
  it("⭐ otomatik modda kutu readOnly + kilit + 'Otomatik oluşturulur…'; tıkla → yazılabilir; boş bırakıp çık → otomatiğe döner", async () => {
    render();
    const input = screen.getByLabelText("Sipariş No") as HTMLInputElement;
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("placeholder", ORDER_NUMBER_AUTO_PLACEHOLDER);
    await userEvent.click(input);
    expect(input).not.toHaveAttribute("readonly");
    await userEvent.type(input, "SIP-1");
    expect(input.value).toBe("SIP-1");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("placeholder", ORDER_NUMBER_AUTO_PLACEHOLDER);
  });

  it("⭐ 409 \"'X' numaralı sipariş zaten var\" → ALAN hatası (form.setError), submit yeniden denenebilir", async () => {
    const err = Object.assign(new Error("409"), { response: { status: 409, data: { success: false, message: "'SIP-1' numaralı sipariş zaten var" } } });
    const onSubmit = vi.fn().mockRejectedValue(err);
    render(onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "Müşteri seç (liste)" }));
    const dialog = (await screen.findAllByRole("dialog")).find((d) => within(d).queryByText("Müşteri seç"))!;
    await userEvent.click(await within(dialog).findByText("Alfa Tekstil"));
    const input = screen.getByLabelText("Sipariş No");
    await userEvent.click(input);
    await userEvent.type(input, "SIP-1");
    await userEvent.click(screen.getByText("stub-satır-gir"));
    await userEvent.click(screen.getByRole("button", { name: "Sipariş Oluştur" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: "SIP-1", customerId: "c1" })));
    expect(await screen.findByText("'SIP-1' numaralı sipariş zaten var")).toBeInTheDocument();
    // Alan hatası, toast değil: sonner mock'una çağrı yok; form hâlâ açık ve yeniden gönderilebilir.
    const { toast } = await import("sonner");
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sipariş Oluştur" })).not.toBeDisabled();
  });
});

describe("OrderFormDialog — boyut (⑤)", () => {
  it("kaynak taraması: DialogContent h-[88vh] + max-w-6xl; eski max-h-[85vh] yok; kalem listesi kendi kaydırıcısı", () => {
    const src = readFileSync(path.join(path.resolve(__dirname), "OrderFormDialog.tsx"), "utf8");
    expect(src).toMatch(/DialogContent className="[^"]*\bh-\[88vh\][^"]*"/);
    expect(src).toMatch(/DialogContent className="[^"]*\bmax-w-6xl[^"]*"/);
    expect(src).not.toMatch(/max-h-\[85vh\]/);
    expect(src).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });
});
