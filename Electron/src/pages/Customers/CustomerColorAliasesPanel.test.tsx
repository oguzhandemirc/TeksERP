// Cari kartı renk adları: genel ad + "yalnız X kumaşında" alt satırları · silme onayı zinciri anlatır ·
// kumaşa özel silme kumaşa özel uca gider · okuma izni yoksa hiç istek atılmaz · Tükenene kadar kumaşta ad salt okunur.
// Negatif sonda (kırmızı görüldü): kumaşa özel satırın silmesi genel uca yönlendirilince silme vakası ❌.
// Ekleme: kumaş seçiliyse kumaşa özel uca, değilse genel uca yazar; renk seçici kumaşın izinli renkleriyle sınırlı ve
// kumaş detayı gelmeden kilitli. Negatif sondalar (kırmızı görüldü): `add` üçlüsü ters çevrilince iki ekleme vakası ❌;
// allowedColorIds geçirilmeyince kısıt vakası ❌; `disabled={colorLocked}` silinince kilit vakası ❌.
// Seçiciler stub'dır: gerçek renk seçici modal kapalıyken de ağ sorgusu atar (test hermetik kalsın).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerColorAliasesPanel } from "./CustomerColorAliasesPanel";
import { customerAliasService } from "./aliasService";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let itemDetail: { data?: { data: { allowedColors: { colorId: string }[] } } } = {};
vi.mock("@/pages/Items/useItemDetail", () => ({ useItemDetail: (id: string) => (id ? itemDetail : {}) }));
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: ({ onChange }: { onChange: (id: string | null, row: null) => void }) => (
    <button type="button" onClick={() => onChange("it-X", null)}>
      stub-kumaş
    </button>
  ),
}));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({
  ColorPickerModal: (p: { value: string | null; onChange: (id: string) => void; allowedColorIds?: string[] | null; disabled?: boolean }) => (
    <button type="button" disabled={p.disabled} data-allowed={JSON.stringify(p.allowedColorIds ?? null)} onClick={() => p.onChange("ekru")}>
      stub-renk:{p.value ?? "yok"}
    </button>
  ),
}));
vi.mock("./aliasService", () => ({
  customerAliasService: {
    listColorAliases: vi.fn(),
    listItemColorAliases: vi.fn(),
    upsertColorAlias: vi.fn(),
    deleteColorAlias: vi.fn(),
    upsertItemColorAlias: vi.fn(),
    deleteItemColorAlias: vi.fn(),
  },
}));

const svc = vi.mocked(customerAliasService);
const EKRU = { id: "ekru", code: "R01", name: "Ekru", hex: "#eee", isActive: true };
const itemRow = (itemName: string, alias: string, lifecycleStatus: "ACTIVE" | "PHASE_OUT" = "ACTIVE") => ({
  id: `i-${itemName}`,
  customerId: "c1",
  itemId: `it-${itemName}`,
  colorId: "ekru",
  alias,
  createdAt: "",
  updatedAt: "",
  item: { id: `it-${itemName}`, code: itemName, name: itemName, lifecycleStatus },
  color: EKRU,
});

beforeEach(() => {
  vi.clearAllMocks();
  perms = ["customer-alias:read", "customer-alias:write"];
  svc.listColorAliases.mockResolvedValue({ success: true, data: [{ id: "g1", customerId: "c1", colorId: "ekru", alias: "KREM", assigned: false, color: EKRU }] });
  svc.listItemColorAliases.mockResolvedValue({ success: true, data: [itemRow("X", "ABC"), itemRow("Y", "CBA", "PHASE_OUT")] });
  svc.deleteItemColorAlias.mockResolvedValue({ success: true, data: { deleted: true } });
  svc.upsertItemColorAlias.mockResolvedValue({ success: true, data: itemRow("X", "ÖZEL") });
  svc.upsertColorAlias.mockResolvedValue({ success: true, data: { id: "g1", customerId: "c1", colorId: "ekru", alias: "GENEL", assigned: false } });
  itemDetail = { data: { data: { allowedColors: [{ colorId: "ekru" }] } } };
});

describe("CustomerColorAliasesPanel", () => {
  it("genel adın altında 'yalnız X kumaşında' satırları listelenir", async () => {
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    expect(await screen.findByDisplayValue("ABC")).toBeInTheDocument();
    expect(screen.getByDisplayValue("KREM")).toBeInTheDocument();
    expect(screen.getByDisplayValue("CBA")).toBeInTheDocument();
    expect(screen.getAllByText(/kumaşında/)).toHaveLength(2);
    expect(svc.listItemColorAliases).toHaveBeenCalledWith("c1");
  });

  it("Tükenene kadar kumaştaki ad salt okunur ama silinebilir", async () => {
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    const locked = await screen.findByDisplayValue("CBA");
    expect(locked).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("ABC")).not.toHaveAttribute("readonly");
    // Satır başına Sil: genel + X + Y.
    expect(screen.getAllByRole("button", { name: "Sil" })).toHaveLength(3);
  });

  it("kumaşa özel ad silinirken onay zinciri anlatır ve kumaşa özel uca gider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    const row = (await screen.findByDisplayValue("ABC")).closest("li")!;
    await user.click(within(row).getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent('"X" kumaşındaki Ekru rengi için "ABC" adı silinecek');
    expect(dialog).toHaveTextContent('müşterinin genel renk adı "KREM"');
    await user.click(within(dialog).getByRole("button", { name: "Sil" }));
    await waitFor(() => expect(svc.deleteItemColorAlias).toHaveBeenCalledWith("c1", "it-X", "ekru"));
    expect(svc.deleteColorAlias).not.toHaveBeenCalled();
  });

  it("yazma izni yoksa ekleme satırı ve düğmeler çizilmez", async () => {
    perms = ["customer-alias:read"];
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    expect(await screen.findByDisplayValue("ABC")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Ekle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sil" })).toBeNull();
  });

  it("okuma izni yoksa hiçbir liste istenmez", () => {
    perms = [];
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    expect(screen.getByText(/yetkiniz yok/)).toBeInTheDocument();
    expect(svc.listColorAliases).not.toHaveBeenCalled();
    expect(svc.listItemColorAliases).not.toHaveBeenCalled();
  });

  it("kumaş seçilince ad kumaşa özel uca yazılır, genel uca değil; renk seçici kumaşın izinli renkleriyle sınırlı", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    await screen.findByDisplayValue("ABC");
    await user.click(screen.getByRole("button", { name: "stub-kumaş" }));
    const picker = screen.getByRole("button", { name: /stub-renk/ });
    expect(picker).toHaveAttribute("data-allowed", '["ekru"]');
    await user.click(picker);
    await user.type(screen.getByPlaceholderText(/örn\. ABC/), "ÖZEL");
    await user.click(screen.getByRole("button", { name: /Ekle/ }));
    await waitFor(() => expect(svc.upsertItemColorAlias).toHaveBeenCalledWith("c1", "it-X", "ekru", "ÖZEL"));
    expect(svc.upsertColorAlias).not.toHaveBeenCalled();
  });

  it("kumaş seçilmezse ad genel uca yazılır ve renk seçici kısıtsızdır", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    await screen.findByDisplayValue("ABC");
    const picker = screen.getByRole("button", { name: /stub-renk/ });
    expect(picker).toHaveAttribute("data-allowed", "null");
    await user.click(picker);
    await user.type(screen.getByPlaceholderText(/örn\. ABC/), "GENEL");
    await user.click(screen.getByRole("button", { name: /Ekle/ }));
    await waitFor(() => expect(svc.upsertColorAlias).toHaveBeenCalledWith("c1", "ekru", "GENEL"));
    expect(svc.upsertItemColorAlias).not.toHaveBeenCalled();
  });

  it("kumaşın izinli renkleri gelmeden renk seçici kilitli (boş liste 'kısıtsız' sayılmaz)", async () => {
    const user = userEvent.setup();
    itemDetail = {};
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    await screen.findByDisplayValue("ABC");
    await user.click(screen.getByRole("button", { name: "stub-kumaş" }));
    expect(screen.getByRole("button", { name: /stub-renk/ })).toBeDisabled();
  });

  it("pasif renkteki ad salt okunur (sunucu 400 verir) ama silinebilir", async () => {
    const PASIF = { ...EKRU, isActive: false };
    svc.listColorAliases.mockResolvedValue({ success: true, data: [{ id: "g1", customerId: "c1", colorId: "ekru", alias: "KREM", assigned: false, color: PASIF }] });
    svc.listItemColorAliases.mockResolvedValue({ success: true, data: [{ ...itemRow("X", "ABC"), color: PASIF }] });
    renderWithProviders(<CustomerColorAliasesPanel customerId="c1" />);
    expect(await screen.findByDisplayValue("ABC")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("KREM")).toHaveAttribute("readonly");
    expect(screen.getAllByRole("button", { name: "Sil" })).toHaveLength(2);
  });
});
