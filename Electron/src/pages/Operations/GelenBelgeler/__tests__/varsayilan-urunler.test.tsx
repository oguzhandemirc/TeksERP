// Müşteri varsayılan ürünleri (E4b): liste, ekle/değiştir/kaldır (seçiciler doğrudan modal), bulunabilirlik ve
// izinsiz kullanıcıda bölümün HİÇ istek atmadan gizlenmesi (H9 403 gerilemesi dersi).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { routeModuleOf } from "@/lib/route-modules";
import { CustomerDefaultsPage, CUSTOMER_DEFAULTS_PATH } from "../MusteriVarsayilanUrunleriPage";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";
import { ApproveDialog } from "../ApproveDialog";
import { AxiosError, type AxiosResponse } from "axios";
import type { CustomerDefaultView } from "../types";

let perms = new Set<string>(["gelen-belge:read", "gelen-belge:template"]);
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.has(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.has(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.has(p)),
    isAdmin: false,
  }),
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
// Seçiciler doğrudan modal açar; burada tık = seçim (modal içi kendi testinde).
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder, onChange }: { placeholder?: string; onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("c9")}>
      {placeholder}
    </button>
  ),
}));
const pickerProps = vi.fn();
vi.mock("@/components/forms/ItemPickerModal", () => ({
  ItemPickerModal: (p: { open: boolean; allowedTypes?: string[]; lifecycle?: string; onPick: (r: { id: string; name: string; code: string }) => void }) => {
    pickerProps({ allowedTypes: p.allowedTypes, lifecycle: p.lifecycle });
    return p.open ? (
      <button type="button" onClick={() => p.onPick({ id: "i7", name: "Gül Ham", code: "K7" })}>
        Modal: Gül Ham
      </button>
    ) : null;
  },
}));

const listCustomerDefaults = vi.fn();
const setCustomerDefault = vi.fn();
const removeCustomerDefault = vi.fn();
const listDeliveryNotes = vi.fn();
const approveNote = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listCustomerDefaults: (...a: unknown[]) => listCustomerDefaults(...a),
  setCustomerDefault: (...a: unknown[]) => setCustomerDefault(...a),
  removeCustomerDefault: (...a: unknown[]) => removeCustomerDefault(...a),
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  approveNote: (...a: unknown[]) => approveNote(...a),
  getSuggestions: () => Promise.resolve({ noteId: "n1", lines: [] }),
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => Promise.resolve({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN" }),
  createManualNote: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
}));

const row = (o: Partial<CustomerDefaultView>): CustomerDefaultView => ({
  customerId: "c1", customer: { id: "c1", code: "C1", name: "Güleçsoy", isActive: true }, item: { id: "i1", code: "K1", name: "Süprem Ham" },
  problem: null, updatedAt: "2026-10-29T08:00:00Z", ...o,
});

beforeEach(() => {
  perms = new Set(["gelen-belge:read", "gelen-belge:template"]);
  listCustomerDefaults.mockReset().mockResolvedValue([row({}), row({ customerId: "c2", customer: { id: "c2", code: "C2", name: "Akın", isActive: true }, problem: "Ürün pasif." })]);
  setCustomerDefault.mockReset().mockResolvedValue(row({}));
  removeCustomerDefault.mockReset().mockResolvedValue({ customerId: "c1" });
  listDeliveryNotes.mockReset().mockResolvedValue({ items: [], nextCursor: null, summary: { DRAFT: 0, APPROVING: 0, APPROVED: 0, PARTIAL: 0, CANCELLED: 0, total: 0 } });
  pickerProps.mockReset();
});

describe("müşteri varsayılan ürünleri sayfası", () => {
  it("liste: müşteri · ürün · son güncelleme; kullanılamaz ürün sorun olarak görünür", async () => {
    renderWithProviders(<CustomerDefaultsPage />);
    const c1 = await screen.findByTestId("customer-default-c1");
    expect(within(c1).getByText(/Süprem Ham/)).toBeInTheDocument();
    expect(within(c1).getByText(/Son güncelleme: 29\.10\.2026/)).toBeInTheDocument();
    expect(within(screen.getByTestId("customer-default-c2")).getByTestId("customer-default-problem").textContent).toContain("Ürün pasif.");
  });

  it("ekle: müşteri seçici + ürün seçici (yalnız aktif kumaş) → PUT", async () => {
    renderWithProviders(<CustomerDefaultsPage />);
    await screen.findByTestId("customer-default-c1");
    const save = screen.getByRole("button", { name: "Kaydet" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Müşteri seç" }));
    await userEvent.click(screen.getByTestId("customer-default-item"));
    await userEvent.click(screen.getByRole("button", { name: "Modal: Gül Ham" }));
    expect(pickerProps).toHaveBeenLastCalledWith({ allowedTypes: ["FABRIC"], lifecycle: "ACTIVE" });
    expect(screen.getByTestId("customer-default-item").textContent).toContain("Gül Ham — K7");
    await userEvent.click(save);
    await waitFor(() => expect(setCustomerDefault).toHaveBeenCalledWith("c9", "i7"));
  });

  it("değiştir: satırın ürün seçicisi → aynı müşteri için PUT", async () => {
    renderWithProviders(<CustomerDefaultsPage />);
    const c1 = await screen.findByTestId("customer-default-c1");
    await userEvent.click(within(c1).getByRole("button", { name: "Değiştir" }));
    await userEvent.click(screen.getByRole("button", { name: "Modal: Gül Ham" }));
    await waitFor(() => expect(setCustomerDefault).toHaveBeenCalledWith("c1", "i7"));
  });

  it("kaldır: onay sorulur, onaydan sonra DELETE", async () => {
    renderWithProviders(<CustomerDefaultsPage />);
    const c1 = await screen.findByTestId("customer-default-c1");
    await userEvent.click(within(c1).getByRole("button", { name: "Kaldır" }));
    expect(await screen.findByText("Müşteri varsayılanı kaldırılsın mı?")).toBeInTheDocument();
    expect(removeCustomerDefault).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(removeCustomerDefault).toHaveBeenCalledWith("c1"));
  });
});

describe("bulunabilirlik ve izin", () => {
  it("karo + palet girişi aynı adres ve izinle; modül kapısı gelenBelge", () => {
    const tile = operationsTiles.find((t) => t.key === "gelen-belge-varsayilan-urunler");
    expect(tile?.to).toBe(CUSTOMER_DEFAULTS_PATH);
    expect(tile?.permission).toBe("gelen-belge:template");
    expect(allCommandEntries.find((e) => e.to === CUSTOMER_DEFAULTS_PATH)?.visibleWhen).toBe(tile?.visibleWhen);
    expect(routeModuleOf(CUSTOMER_DEFAULTS_PATH)).toBe("gelenBelgeEnabled");
  });

  it("gelen-belge:template olan kullanıcı listede bağlantıyı görür", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    expect(await screen.findByRole("link", { name: /Müşteri varsayılanları/ })).toHaveAttribute("href", expect.stringContaining("varsayilan-urunler"));
  });

  it("izinsiz kullanıcı: bağlantı yok ve varsayılan listesi İSTENMEZ (403 uyarısı doğmaz)", async () => {
    perms = new Set(["gelen-belge:read", "gelen-belge:write", "gelen-belge:approve"]);
    renderWithProviders(<IncomingDocumentsPage />);
    await waitFor(() => expect(listDeliveryNotes).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Müşteri varsayılanları/ })).toBeNull();
    expect(listCustomerDefaults).not.toHaveBeenCalled();
  });
});

describe("onay 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE yönlendirmesi kaynağa göre", () => {
  const unusable = (source: string) =>
    new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message: "Backend yönlendirmesi", details: { code: "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE", source } } } as AxiosResponse);
  it("CUSTOMER → müşteri varsayılanı metni + yönetim ekranı bağlantısı", async () => {
    approveNote.mockRejectedValueOnce(unusable("CUSTOMER"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    expect((await screen.findByTestId("approve-error")).textContent).toContain("müşterinin varsayılan ürününü düzeltin");
    expect(screen.getByTestId("approve-error-fix-link")).toHaveAttribute("href", expect.stringContaining("varsayilan-urunler"));
  });
  it("FACTORY → fabrika metni + backend mesajı; müşteri bağlantısı YOK", async () => {
    approveNote.mockRejectedValueOnce(unusable("FACTORY"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const t = (await screen.findByTestId("approve-error")).textContent ?? "";
    expect(t).toContain("fabrika ayarındaki varsayılan ürünü düzeltin");
    expect(t).toContain("Backend yönlendirmesi");
    expect(screen.queryByTestId("approve-error-fix-link")).toBeNull();
  });
});
