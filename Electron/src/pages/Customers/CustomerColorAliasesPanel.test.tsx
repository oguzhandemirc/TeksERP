// Cari kartı renk adları: genel ad + "yalnız X kumaşında" alt satırları · silme onayı zinciri anlatır ·
// kumaşa özel silme kumaşa özel uca gider · okuma izni yoksa hiç istek atılmaz · Tükenene kadar kumaşta ad salt okunur.
// Negatif sonda (kırmızı görüldü): kumaşa özel satırın silmesi genel uca yönlendirilince silme vakası ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerColorAliasesPanel } from "./CustomerColorAliasesPanel";
import { customerAliasService } from "./aliasService";

let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
});
