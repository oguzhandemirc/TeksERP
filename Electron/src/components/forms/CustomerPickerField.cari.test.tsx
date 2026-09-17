// =============================================================================
// BEKÇİ — cari seçici CARİ kipi (muhasebe formları, rol modeli faz 2 dilim F): her rol · Yön tam liste · fason bacağı
// yok · "Yeni cari" yok · DURUM süzgeci (Aktif · Pasif · Tümü; varsayılan Aktif) — pasif kartın açık bakiyesine
// tahsilat/ödeme için Pasif/Tümü, satır "(pasif)" rozetli · seçim `kind:"CUSTOMER"` → `onChange(id)`.
// =============================================================================
// Negatif sonda (kırmızı görüldü): `useSupplierPickerData` cari kipinde `statusFilters` yerine `supplierListFilters`
// tabanını kullanınca (Tümü/Pasif seçimi isteğe inmez) (3) ❌; `legsFor("cari")` tabana `isCustomerRole` koyunca (1) ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerPickerField } from "./CustomerPickerField";

const listCursor = vi.fn();
const subsGetAll = vi.fn();
vi.mock("@/pages/Customers/service", () => ({
  customerService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/pages/Customers/CustomerFormDialog", () => ({ CustomerFormDialog: () => null }));
vi.mock("@/pages/Customers/schema", () => ({ customerCardPayload: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: (...a: unknown[]) => subsGetAll(...a), getById: vi.fn() } }));

const CUSTOMERS = [
  { id: "c1", code: "TED1", name: "İplik A.Ş.", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false, taxNumber: null, contactPhone: null, isActive: true },
  { id: "c2", code: "MUS1", name: "Yalnız Müşteri", isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, taxNumber: null, contactPhone: null, isActive: true },
  { id: "c3", code: "FSN1", name: "Boyahane Kart", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true, taxNumber: null, contactPhone: null, isActive: true },
  { id: "c4", code: "ESKI", name: "Kapanmış Firma", isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, taxNumber: null, contactPhone: null, isActive: false },
];
const cursorPage = (data: unknown[]) => Promise.resolve({ success: true, data, pagination: { nextCursor: null, hasMore: false, limit: 50 } });

beforeEach(() => {
  listCursor.mockReset();
  subsGetAll.mockReset();
  listCursor.mockImplementation((p: { filters?: Record<string, string> }) => {
    let rows = CUSTOMERS;
    const act = p.filters?.isActive;
    if (act !== undefined) rows = rows.filter((c) => c.isActive === (act === "true"));
    for (const k of ["isCustomerRole", "isSupplierRole", "isSubcontractorRole"] as const) {
      const v = p.filters?.[k];
      if (v !== undefined) rows = rows.filter((c) => c[k] === (v === "true"));
    }
    if (p.filters?.role === "customer") rows = rows.filter((c) => c.isCustomerRole);
    if (p.filters?.role === "supplier") rows = rows.filter((c) => c.isSupplierRole);
    return cursorPage(rows);
  });
});

async function openCari(onChange: (id: string | null) => void = () => {}) {
  renderWithProviders(<CustomerPickerField variant="cari" value={null} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "Cari seç (liste)" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("İplik A.Ş.");
  return dialog;
}
const durum = (d: HTMLElement) => within(d).getByRole("combobox", { name: "Durum" });

describe("CustomerPickerField — cari kipi", () => {
  it("(1) ⭐ her rol tek listede, taban rol süzgeci YOK, yalnız AKTİF; fason bacağı ve 'Yeni cari' yok; Rol kolonu", async () => {
    const dialog = await openCari();
    expect(within(dialog).getByText("Cari seç")).toBeInTheDocument();
    for (const n of ["İplik A.Ş.", "Yalnız Müşteri", "Boyahane Kart"]) expect(within(dialog).getByText(n)).toBeInTheDocument();
    expect(within(dialog).queryByText("Kapanmış Firma")).toBeNull();
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true" } }));
    expect(subsGetAll).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("button", { name: /Yeni (cari|müşteri)/ })).toBeNull();
    expect(within(dialog).getByText("Rol")).toBeInTheDocument();
    expect(within(within(dialog).getByText("Boyahane Kart").closest("tr") as HTMLElement).getByText("Tedarikçi · Fason")).toBeInTheDocument();
    expect(durum(dialog)).toHaveTextContent("Durum: Aktif");
  });

  it("(2) Yön tam liste (Tümü · Müşteri · Tedarikçi · Müşteri + Tedarikçi); 'Müşteri' → role=customer", async () => {
    const dialog = await openCari();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Yön" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Müşteri + Tedarikçi"]);
    await userEvent.click(screen.getByRole("option", { name: "Müşteri" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", role: "customer" } })));
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(within(dialog).getByText("Yalnız Müşteri")).toBeInTheDocument();
  });

  it("(3) ⭐ Durum: varsayılan listede pasif YOK; 'Tümü' → isActive süzgeci düşer, pasif satır '(pasif)' rozetiyle gelir; 'Pasif' → yalnız pasif", async () => {
    const dialog = await openCari();
    await userEvent.click(durum(dialog));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Aktif", "Pasif", "Tümü"]);
    await userEvent.click(screen.getByRole("option", { name: "Tümü" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: {} })));
    const pasif = await within(dialog).findByText("Kapanmış Firma");
    expect(within(pasif.closest("tr") as HTMLElement).getByText("(pasif)")).toBeInTheDocument();
    expect(within(dialog).getByText("İplik A.Ş.")).toBeInTheDocument();
    expect(durum(dialog)).toHaveTextContent("Durum: Tümü");
    await userEvent.click(durum(dialog));
    await userEvent.click(screen.getByRole("option", { name: "Pasif" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "false" } })));
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(within(dialog).getByText("Kapanmış Firma")).toBeInTheDocument();
  });

  it("(4) satıra tıkla → onChange(kart id), modal kapanır", async () => {
    const onChange = vi.fn();
    const dialog = await openCari(onChange);
    await userEvent.click(within(dialog).getByText("Boyahane Kart"));
    expect(onChange).toHaveBeenCalledWith("c3");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
