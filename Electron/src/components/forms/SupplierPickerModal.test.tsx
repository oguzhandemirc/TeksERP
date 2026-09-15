// =============================================================================
// BEKÇİ — Tedarikçi liste modalı (istek #5 rev.): kutuya tıkla → modal · TAM liste (müşteri-only dahil) sayfalı ·
// rol seçimi SUNUCU parametresi (filter[type] / yalnız fason) · arama sunucuya · satıra tıkla → forma
// =============================================================================
// Negatif sonda (kırmızı görüldü): `supplierRoleQuery` Fason'da cari sorgusunu KAPATMAYINCA "yalnız Fason" ❌;
// `useSupplierPickerData` `filters.type`ı göndermeyince "rol sunucuya" ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierSelect } from "./SupplierSelect";
import { SUPPLIER_PICKER_EMPTY } from "./SupplierPickerModal";

const listCursor = vi.fn();
const subsGetAll = vi.fn();
vi.mock("@/pages/Customers/service", () => ({ customerService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: vi.fn(), getById: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: (...a: unknown[]) => subsGetAll(...a), getById: vi.fn() } }));

const CUSTOMERS = [
  { id: "c1", code: "TED1", name: "İplik A.Ş.", type: "SUPPLIER", taxNumber: "1110001112", contactPhone: "0212 111", isActive: true },
  { id: "c2", code: "BOTH1", name: "Hem Alır Hem Satar", type: "BOTH", taxNumber: null, contactPhone: null, isActive: true },
  { id: "c3", code: "MUS1", name: "Yalnız Müşteri", type: "CUSTOMER", taxNumber: null, contactPhone: null, isActive: true },
];
const SUBS = [{ id: "s1", code: "FAS1", name: "Boyahane Ltd", taxNumber: "2220003334", phone: "0532 222", isActive: true }];

const cursorPage = (data: unknown[], nextCursor: string | null = null) =>
  Promise.resolve({ success: true, data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50, totalEstimate: 3 } });
const offsetPage = (data: unknown[]) => Promise.resolve({ success: true, data, pagination: { page: 1, pageSize: 50, total: data.length, totalPages: 1 } });

beforeEach(() => {
  listCursor.mockReset();
  subsGetAll.mockReset();
  listCursor.mockImplementation((p: { filters?: Record<string, string>; search?: string }) => {
    let rows = CUSTOMERS;
    if (p.filters?.type) rows = rows.filter((c) => c.type === p.filters!.type);
    if (p.search) rows = rows.filter((c) => c.name.includes(p.search!));
    return cursorPage(rows);
  });
  subsGetAll.mockImplementation((p: { search?: string }) => offsetPage(p.search ? SUBS.filter((s) => s.name.includes(p.search!)) : SUBS));
});

async function openModal(onChange: (v: unknown) => void = () => {}) {
  renderWithProviders(<SupplierSelect value={null} onChange={onChange} modalPicker />);
  expect(screen.queryByRole("dialog")).toBeNull();
  // Formda küçük açılır liste (combobox tetiği) HİÇ çizilmez — kutu düğmedir.
  expect(screen.queryByRole("combobox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Boyahane Ltd");
  return dialog;
}

describe("SupplierSelect (form) + SupplierPickerModal", () => {
  it("⭐ kutuya tıklayınca DOĞRUDAN modal (combobox yok); TAM liste: müşteri-only dahil, Rol kolonu ayırt eder; kolonlar", async () => {
    const dialog = await openModal();
    for (const h of ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"]) expect(within(dialog).getByText(h)).toBeInTheDocument();
    for (const n of ["İplik A.Ş.", "Hem Alır Hem Satar", "Yalnız Müşteri", "Boyahane Ltd"]) expect(within(dialog).getByText(n)).toBeInTheDocument();
    const musteriRow = within(dialog).getByText("Yalnız Müşteri").closest("tr") as HTMLElement;
    expect(within(musteriRow).getByText("Müşteri")).toBeInTheDocument();
    const fasonRow = within(dialog).getByText("Boyahane Ltd").closest("tr") as HTMLElement;
    expect(within(fasonRow).getByText("Fason")).toBeInTheDocument();
    expect(within(fasonRow).getByText("2220003334")).toBeInTheDocument();
    // ilk açılışta filtre YOK: cari sorgusu type'sız, fason sorgusu da atıldı; sayfa boyu 50
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, filters: { isActive: "true" } }));
    expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
    expect(within(dialog).getByText(/Yüklü 4/)).toBeInTheDocument();
  });

  it("⭐ rol seçimi SUNUCUYA gider: Tedarikçi → filter[type]=SUPPLIER ve fason sorgusu YOK; Fason → yalnız fason", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    subsGetAll.mockClear();
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Rol" }), "SUPPLIER");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", type: "SUPPLIER" } })));
    await waitFor(() => expect(within(dialog).queryByText("Boyahane Ltd")).toBeNull());
    expect(within(dialog).getByText("İplik A.Ş.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(subsGetAll).not.toHaveBeenCalled();
    listCursor.mockClear();
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Rol" }), "SUBCONTRACTOR");
    await within(dialog).findByText("Boyahane Ltd");
    expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull();
    expect(listCursor).not.toHaveBeenCalled();
  });

  it("arama sunucuya gider (iki bacak)", async () => {
    const dialog = await openModal();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tedarikçi ara" }), "Boya");
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ search: "Boya" })));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ search: "Boya" })));
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(within(dialog).getByText("Boyahane Ltd")).toBeInTheDocument();
  });

  it("⭐ satıra tıklayınca seçim forma yazılır (kind + id) ve modal kapanır", async () => {
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByText("Boyahane Ltd"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "SUBCONTRACTOR", id: "s1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sayfalı: ilk sayfada nextCursor varsa 'Yüklü … / toplam' sayacı ve devam; seçili kayıt kutuda etiketle, nullable'da temizle (×)", async () => {
    listCursor.mockImplementation((p: { cursor?: string | null }) => (p.cursor ? cursorPage([CUSTOMERS[2]]) : cursorPage(CUSTOMERS.slice(0, 2), "c2")));
    renderWithProviders(<SupplierSelect value={{ kind: "SUBCONTRACTOR", id: "s1" }} selectedLabel="FAS1 — Boyahane Ltd" onChange={() => {}} nullable modalPicker />);
    expect(screen.getByRole("button", { name: "Tedarikçi seç (liste)" })).toHaveTextContent("FAS1 — Boyahane Ltd");
    expect(screen.getByRole("button", { name: "Tedarikçiyi temizle" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("İplik A.Ş.");
    // Sayfalı: ilk sayfa nextCursor "c2" → sonraki sayfa cursor ile istenir ("Daha fazla yükle" düğmesi YOK;
    // kısa liste koruması / sentinel otomatik yükler) ve üçüncü cari gelir; sayaç toplamı 3 + 1 = 4.
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: "c2" })));
    await within(dialog).findByText("Yalnız Müşteri");
    expect(within(dialog).getByText(/Yüklü 4 \/ 4 kayıt/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Daha fazla/i })).toBeNull();
  });

  it("boş listede yönlendirme: Tanımlar → İş Ortakları → Cariler", async () => {
    listCursor.mockImplementation(() => cursorPage([]));
    subsGetAll.mockImplementation(() => offsetPage([]));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    await within(await screen.findByRole("dialog")).findByText(SUPPLIER_PICKER_EMPTY);
  });

  it("modalPicker verilmeyen kutu (filtre şeridi): küçük açılır liste bayt bayt, modal düğmesi YOK", () => {
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tedarikçi seç (liste)" })).toBeNull();
  });
});
