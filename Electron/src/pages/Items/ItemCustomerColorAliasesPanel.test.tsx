// Kumaş kartı "Müşteri Renk Adları": müşteriye göre gruplu liste · cari kartıyla AYNI uca yazar/siler ·
// Tükenene kadar kumaşta ekleme yok · sekme yalnız düzenlenen KUMAŞ kartında ve okuma izniyle çizilir.
// Negatif sonda (kırmızı görüldü): ItemCardTabs izin kontrolü kaldırılınca "izin yoksa sekme yok" vakası ❌.
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
