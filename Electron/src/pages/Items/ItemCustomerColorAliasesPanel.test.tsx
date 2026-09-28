// Kumaş kartı "Müşteri Renk Adları": müşteriye göre gruplu liste · cari kartıyla AYNI uca yazar/siler ·
// Tükenene kadar kumaşta ekleme yok · sekme yalnız düzenlenen KUMAŞ kartında ve okuma izniyle çizilir.
// Negatif sonda (kırmızı görüldü): ItemCardTabs izin kontrolü kaldırılınca "izin yoksa sekme yok" vakası ❌.
// Ekleme: müşteri + renk + ad → kumaşa özel uç (bu kumaş); müşteri değişince renk sıfırlanır; pasif renkte ad salt okunur.
// Negatif sondalar (kırmızı görüldü): onAdd'de itemId/müşteri yer değişince ekleme vakası ❌; müşteri değişiminde
// setColorId(null) silinince sıfırlama vakası ❌; colorAcceptsAlias silinince pasif renk vakası ❌.
// Seçiciler stub'dır: gerçek renk seçici modal kapalıyken de ağ sorgusu atar (test hermetik kalsın).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { customerAliasService } from "@/pages/Customers/aliasService";
import { ItemCustomerColorAliasesPanel, groupByCustomer } from "./ItemCustomerColorAliasesPanel";
import { ItemCardTabs } from "./ItemCardTabs";
import type { Item } from "./types";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <>
      <button type="button" onClick={() => onChange("a")}>stub-müşteri-a</button>
      <button type="button" onClick={() => onChange("b")}>stub-müşteri-b</button>
    </>
  ),
}));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({
  ColorPickerModal: (p: { value: string | null; onChange: (id: string) => void; allowedColorIds?: string[] | null; customerId?: string | null }) => (
    <button type="button" data-allowed={JSON.stringify(p.allowedColorIds ?? null)} data-customer={p.customerId ?? ""} onClick={() => p.onChange("ekru")}>
      stub-renk:{p.value ?? "yok"}
    </button>
  ),
}));
vi.mock("@/pages/Customers/aliasService", () => ({
  customerAliasService: {
    listColorAliases: vi.fn(),
    listItemColorAliasesByItem: vi.fn(),
    upsertItemColorAlias: vi.fn(),
    deleteItemColorAlias: vi.fn(),
  },
}));

const svc = vi.mocked(customerAliasService);
const EKRU = { id: "ekru", code: "R01", name: "Ekru", hex: null, isActive: true };
const LACI = { id: "laci", code: "R02", name: "Lacivert", hex: null, isActive: true };
const row = (customer: { id: string; name: string }, color: typeof EKRU, alias: string) => ({
  id: `${customer.id}-${color.id}`,
  customerId: customer.id,
  itemId: "x",
  colorId: color.id,
  alias,
  createdAt: "",
  updatedAt: "",
  customer: { id: customer.id, code: customer.id.toUpperCase(), name: customer.name, isActive: true },
  color,
});
const A = { id: "a", name: "A Tekstil" };
const B = { id: "b", name: "B Konfeksiyon" };
const ITEM = { id: "x", name: "X", lifecycle: "ACTIVE" as const, allowedColorIds: ["ekru", "laci"] };

beforeEach(() => {
  vi.clearAllMocks();
  perms = ["customer-alias:read", "customer-alias:write"];
  svc.listItemColorAliasesByItem.mockResolvedValue({ success: true, data: [row(A, EKRU, "ABC"), row(B, EKRU, "KUM"), row(A, LACI, "GECE")] });
  svc.listColorAliases.mockResolvedValue({ success: true, data: [] });
  svc.deleteItemColorAlias.mockResolvedValue({ success: true, data: { deleted: true } });
  svc.upsertItemColorAlias.mockResolvedValue({ success: true, data: row(A, EKRU, "ÖZEL") });
});

describe("ItemCustomerColorAliasesPanel", () => {
  it("müşteriye göre gruplar, grup içinde renk adına göre sıralar", () => {
    const groups = groupByCustomer([row(A, LACI, "GECE"), row(B, EKRU, "KUM"), row(A, EKRU, "ABC")]);
    expect(groups.map((g) => g.customer?.name)).toEqual(["A Tekstil", "B Konfeksiyon"]);
    expect(groups[0]!.rows.map((r) => r.alias)).toEqual(["ABC", "GECE"]);
  });

  it("bütün müşterilerin bu kumaştaki adlarını listeler ve silmede aynı uca gider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemCustomerColorAliasesPanel item={ITEM} />);
    expect(await screen.findByDisplayValue("KUM")).toBeInTheDocument();
    expect(screen.getByText("A Tekstil")).toBeInTheDocument();
    expect(svc.listItemColorAliasesByItem).toHaveBeenCalledWith("x");
    const li = screen.getByDisplayValue("KUM").closest("li")!;
    await user.click(within(li).getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog");
    // Müşterinin genel adı yok → bizdeki ad.
    await waitFor(() => expect(dialog).toHaveTextContent('bizdeki ad "Ekru"'));
    await user.click(within(dialog).getByRole("button", { name: "Sil" }));
    await waitFor(() => expect(svc.deleteItemColorAlias).toHaveBeenCalledWith("b", "x", "ekru"));
  });

  it("Tükenene kadar kumaşta ekleme satırı yok, adlar salt okunur", async () => {
    renderWithProviders(<ItemCustomerColorAliasesPanel item={{ ...ITEM, lifecycle: "PHASE_OUT" }} />);
    expect(await screen.findByDisplayValue("ABC")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Ekle/ })).toBeNull();
    expect(screen.getByText(/yeni ad eklenemez/)).toBeInTheDocument();
  });

  it("müşteri + renk + ad → bu kumaşın kumaşa özel ucuna yazar; renk seçici kumaşın izinli renkleri ve müşteriyle", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemCustomerColorAliasesPanel item={ITEM} />);
    await screen.findByDisplayValue("KUM");
    await user.click(screen.getByRole("button", { name: "stub-müşteri-a" }));
    const picker = screen.getByRole("button", { name: /stub-renk/ });
    expect(picker).toHaveAttribute("data-allowed", '["ekru","laci"]');
    expect(picker).toHaveAttribute("data-customer", "a");
    await user.click(picker);
    await user.type(screen.getByPlaceholderText(/örn\. ABC/), "ÖZEL");
    await user.click(screen.getByRole("button", { name: /Ekle/ }));
    await waitFor(() => expect(svc.upsertItemColorAlias).toHaveBeenCalledWith("a", "x", "ekru", "ÖZEL"));
  });

  it("müşteri değişince seçili renk sıfırlanır (başka müşterinin özel rengi taşınmaz)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemCustomerColorAliasesPanel item={ITEM} />);
    await screen.findByDisplayValue("KUM");
    await user.click(screen.getByRole("button", { name: "stub-müşteri-a" }));
    await user.click(screen.getByRole("button", { name: /stub-renk/ }));
    await user.type(screen.getByPlaceholderText(/örn\. ABC/), "ÖZEL");
    expect(screen.getByRole("button", { name: /Ekle/ })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "stub-müşteri-b" }));
    expect(screen.getByRole("button", { name: /stub-renk/ })).toHaveTextContent("stub-renk:yok");
    expect(screen.getByRole("button", { name: /Ekle/ })).toBeDisabled();
  });

  it("pasif renkteki ad salt okunur ama silinebilir", async () => {
    svc.listItemColorAliasesByItem.mockResolvedValue({ success: true, data: [row(A, { ...EKRU, isActive: false }, "ABC"), row(B, LACI, "KUM")] });
    renderWithProviders(<ItemCustomerColorAliasesPanel item={ITEM} />);
    expect(await screen.findByDisplayValue("ABC")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("KUM")).not.toHaveAttribute("readonly");
    expect(screen.getAllByRole("button", { name: "Sil" })).toHaveLength(2);
  });
});

describe("ItemCardTabs", () => {
  const fabric = { id: "x", name: "X", itemType: "FABRIC", isActive: true, allowedColors: [] } as unknown as Item;

  it("düzenlenen kumaş kartında ve okuma izniyle sekme çizilir", () => {
    renderWithProviders(<ItemCardTabs item={fabric}><div>form</div></ItemCardTabs>);
    expect(screen.getByRole("tab", { name: "Müşteri Renk Adları" })).toBeInTheDocument();
  });

  it("izin yoksa, yeni kartta ya da iplik kartında sekme yok — form tek başına", () => {
    perms = [];
    const { unmount } = renderWithProviders(<ItemCardTabs item={fabric}><div>form</div></ItemCardTabs>);
    expect(screen.queryByRole("tab")).toBeNull();
    unmount();
    perms = ["customer-alias:read"];
    renderWithProviders(<ItemCardTabs item={{ ...fabric, itemType: "YARN" } as Item}><div>form</div></ItemCardTabs>);
    expect(screen.queryByRole("tab")).toBeNull();
    renderWithProviders(<ItemCardTabs item={null}><div>yeni</div></ItemCardTabs>);
    expect(screen.getByText("yeni")).toBeInTheDocument();
  });
});
