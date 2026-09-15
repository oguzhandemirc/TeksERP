// =============================================================================
// BEKÇİ — Tedarikçi liste modalı (istek #5): düğmeden açılır · rol süzgeci süzer (Fason satırı Rol "Fason") ·
// satıra tıklayınca seçim forma yazılır · müşteri-only kart listelenmez · boş listede yönlendirme metni
// =============================================================================
// Negatif sonda (kırmızı görüldü): `toSupplierPickerRows` CUSTOMER tipini de eklerse "müşteri-only listelenmez" ❌;
// `filterSupplierRows` süzgeci düşürülünce "yalnız Fason" ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierSelect } from "./SupplierSelect";
import { SUPPLIER_PICKER_EMPTY } from "./SupplierPickerModal";

const customers = vi.fn();
const subs = vi.fn();
vi.mock("@/pages/Customers/service", () => ({ customerService: { getAll: (...a: unknown[]) => customers(...a), getById: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: (...a: unknown[]) => subs(...a), getById: vi.fn() } }));

const page = (data: unknown[]) => Promise.resolve({ success: true, data, pagination: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } });

beforeEach(() => {
  customers.mockReset();
  subs.mockReset();
  customers.mockImplementation(() =>
    page([
      { id: "c1", code: "TED1", name: "İplik A.Ş.", type: "SUPPLIER", taxNumber: "1110001112", contactPhone: "0212 111", isActive: true },
      { id: "c2", code: "BOTH1", name: "Hem Alır Hem Satar", type: "BOTH", taxNumber: null, contactPhone: null, isActive: true },
      { id: "c3", code: "MUS1", name: "Yalnız Müşteri", type: "CUSTOMER", taxNumber: null, contactPhone: null, isActive: true },
    ]),
  );
  subs.mockImplementation(() => page([{ id: "s1", code: "FAS1", name: "Boyahane Ltd", taxNumber: "2220003334", phone: "0532 222", isActive: true }]));
});

describe("SupplierSelect + SupplierPickerModal", () => {
  it("⭐ modal düğmeden açılır; kolonlar Kod · Ünvan · Rol · Vergi No · Telefon; müşteri-only kart YOK; Fason satırı Rol Fason", async () => {
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Listeden seç (filtreli)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Boyahane Ltd");
    for (const h of ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"]) expect(within(dialog).getByText(h)).toBeInTheDocument();
    expect(within(dialog).getByText("İplik A.Ş.")).toBeInTheDocument();
    expect(within(dialog).getByText("Hem Alır Hem Satar")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    const fasonRow = within(dialog).getByText("Boyahane Ltd").closest("tr") as HTMLElement;
    expect(within(fasonRow).getByText("Fason")).toBeInTheDocument();
    expect(within(fasonRow).getByText("2220003334")).toBeInTheDocument();
    expect(within(fasonRow).getByText("0532 222")).toBeInTheDocument();
  });

  it("⭐ rol süzgeci: Tedarikçi ve Alıcı + Satıcı kapatılınca yalnız Fason kalır", async () => {
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Listeden seç (filtreli)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Boyahane Ltd");
    const group = within(dialog).getByRole("group", { name: "Rol süzgeci" });
    await userEvent.click(within(group).getByRole("button", { name: "Tedarikçi" }));
    await userEvent.click(within(group).getByRole("button", { name: "Alıcı + Satıcı" }));
    expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull();
    expect(within(dialog).queryByText("Hem Alır Hem Satar")).toBeNull();
    expect(within(dialog).getByText("Boyahane Ltd")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Fason" })).toHaveAttribute("aria-pressed", "true");
  });

  it("⭐ satıra tıklayınca seçim forma yazılır (kind + id) ve modal kapanır", async () => {
    const onChange = vi.fn();
    renderWithProviders(<SupplierSelect value={null} onChange={onChange} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Listeden seç (filtreli)" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByText("Boyahane Ltd"));
    // DataTable satır tıklaması çift-tık ayrımı için gecikmeli (ROW_OPEN_DELAY_MS) — bekle.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "SUBCONTRACTOR", id: "s1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("boş listede yönlendirme: Tanımlar → İş Ortakları → Cariler", async () => {
    customers.mockImplementation(() => page([]));
    subs.mockImplementation(() => page([]));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Listeden seç (filtreli)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(SUPPLIER_PICKER_EMPTY);
  });

  it("modalPicker verilmeyen kutuda düğme YOK (filtre şeridi bayt bayt)", () => {
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Listeden seç (filtreli)" })).toBeNull();
  });
});
