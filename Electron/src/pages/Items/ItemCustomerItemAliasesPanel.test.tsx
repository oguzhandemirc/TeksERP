// B13 — Kumaş kartı "Müşteri Kumaş Adları": ürün tarafı listeyi okur, cari kartıyla AYNI uca yazar/siler;
// Tükenene kadar kumaşta ekleme yok; sekme şeridinde "Müşteri Renk Adları"nın yanında çizilir.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { customerAliasService } from "@/pages/Customers/aliasService";
import { ItemCustomerItemAliasesPanel } from "./ItemCustomerItemAliasesPanel";
import { ItemCardTabs } from "./ItemCardTabs";
import type { Item } from "./types";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("a")}>stub-müşteri-a</button>
  ),
}));
vi.mock("@/pages/Customers/aliasService", () => ({
  customerAliasService: {
    listItemAliasesByItem: vi.fn(),
    upsertItemAlias: vi.fn(),
    deleteItemAlias: vi.fn(),
    listItemColorAliasesByItem: vi.fn(),
    listColorAliases: vi.fn(),
  },
}));

const svc = vi.mocked(customerAliasService);
const ROW = { id: "r1", customerId: "b", itemId: "x", alias: "BELLE", customer: { id: "b", code: "MUS-2", name: "B Konfeksiyon", isActive: true } };

beforeEach(() => {
  perms = ["customer-alias:read", "customer-alias:write"];
  svc.listItemAliasesByItem.mockReset().mockResolvedValue({ success: true, data: [ROW] });
  svc.upsertItemAlias.mockReset().mockResolvedValue({ success: true, data: ROW });
  svc.deleteItemAlias.mockReset().mockResolvedValue({ success: true, data: undefined });
  svc.listItemColorAliasesByItem.mockReset().mockResolvedValue({ success: true, data: [] });
});

describe("Müşteri Kumaş Adları (B13)", () => {
  it("⭐ ürün tarafı uçtan listeler: müşteri adı + kodu + müşterideki ad", async () => {
    renderWithProviders(<ItemCustomerItemAliasesPanel item={{ id: "x", name: "X", lifecycle: "ACTIVE" }} />);
    expect(await screen.findByText("B Konfeksiyon")).toBeInTheDocument();
    expect(screen.getByText("MUS-2")).toBeInTheDocument();
    expect(svc.listItemAliasesByItem).toHaveBeenCalledWith("x");
    expect((screen.getAllByLabelText("Müşterideki ad")[0] as HTMLInputElement).value).toBe("BELLE");
  });

  it("⭐ ekleme cari kartıyla AYNI uca (müşteri, bu kumaş, ad)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemCustomerItemAliasesPanel item={{ id: "x", name: "X", lifecycle: "ACTIVE" }} />);
    await screen.findByText("B Konfeksiyon");
    await user.click(screen.getByText("stub-müşteri-a"));
    await user.type(screen.getByLabelText("Müşterideki kumaş adı"), "aktos");
    await user.click(screen.getByRole("button", { name: /Ekle/ }));
    await waitFor(() => expect(svc.upsertItemAlias).toHaveBeenCalledWith("a", "x", "aktos"));
  });

  it("silme onaydan sonra cari ucuna gider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ItemCustomerItemAliasesPanel item={{ id: "x", name: "X", lifecycle: "ACTIVE" }} />);
    await screen.findByText("B Konfeksiyon");
    await user.click(screen.getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("“BELLE” adı silinecek");
    await user.click(within(dialog).getByRole("button", { name: "Sil" }));
    await waitFor(() => expect(svc.deleteItemAlias).toHaveBeenCalledWith("b", "x"));
  });

  it("'Tükenene kadar' kumaşta ekleme satırı yok, uyarı var", async () => {
    renderWithProviders(<ItemCustomerItemAliasesPanel item={{ id: "x", name: "X", lifecycle: "PHASE_OUT" }} />);
    await screen.findByText("B Konfeksiyon");
    expect(screen.queryByText("stub-müşteri-a")).toBeNull();
    expect(screen.getByText(/yeni ad eklenemez/)).toBeInTheDocument();
  });

  it("⭐ kumaş kartında sekme şeridi: Bilgiler · Müşteri Kumaş Adları · Müşteri Renk Adları", () => {
    const item = { id: "x", name: "X", itemType: "FABRIC", lifecycleStatus: "ACTIVE", isActive: true, allowedColors: [] } as unknown as Item;
    renderWithProviders(<ItemCardTabs item={item}><div>form</div></ItemCardTabs>);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bilgiler", "Müşteri Kumaş Adları", "Müşteri Renk Adları"]);
  });
});
