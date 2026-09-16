// =============================================================================
// BEKÇİ — Tedarikçi seçici modalı v3 (kabul A): kutu → modal · rol FARE ve KLAVYE ile · tek bacak 500 ·
// ALL'da bacak geçişi · arama · satır → forma · kaynak taraması (yerleşik <select> / DataTable YOK)
// =============================================================================
// Negatif sonda (kırmızı görüldü): modal ağacına `<select>` eklenince (7) ❌; `legsFor` Fason'da cari bacağını
// kapatmayınca "yalnız fason" ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierSelect } from "./SupplierSelect";
import { SUPPLIER_PICKER_EMPTY } from "./SupplierPickerModal";
import { subcontractorService } from "@/pages/Subcontractors/service";

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
const cursorPage = (data: unknown[], nextCursor: string | null = null) => Promise.resolve({ success: true, data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50 } });
const offsetPage = (data: unknown[], page = 1, totalPages = 1) => Promise.resolve({ success: true, data, pagination: { page, pageSize: 50, total: data.length, totalPages } });

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
  expect(screen.queryByRole("combobox")).toBeNull(); // formda küçük açılır liste HİÇ çizilmez
  await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Boyahane Ltd");
  return dialog;
}
const roleTrigger = (dialog: HTMLElement) => within(dialog).getByRole("combobox", { name: "Rol" });

describe("SupplierPickerModal v3", () => {
  it("(1) ⭐ kutuya tıkla → dialog; TAM liste (müşteri-only dahil, Rol ayırt eder); kolonlar; sayfa 50, ilk açılışta filtre yok", async () => {
    const dialog = await openModal();
    for (const h of ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"]) expect(within(dialog).getByText(h)).toBeInTheDocument();
    for (const n of ["İplik A.Ş.", "Hem Alır Hem Satar", "Yalnız Müşteri", "Boyahane Ltd"]) expect(within(dialog).getByText(n)).toBeInTheDocument();
    expect(within(within(dialog).getByText("Yalnız Müşteri").closest("tr") as HTMLElement).getByText("Müşteri")).toBeInTheDocument();
    expect(within(within(dialog).getByText("Boyahane Ltd").closest("tr") as HTMLElement).getByText("Fason")).toBeInTheDocument();
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, filters: { isActive: "true" } }));
    expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
    expect(within(dialog).getByText("Yüklü 4 kayıt")).toBeInTheDocument();
    expect(within(dialog).getByText("Tüm kayıtlar yüklendi")).toBeInTheDocument();
  });

  it("(2a) ⭐ rol FARE ile: tetik → seçenek 'Tedarikçi' → sunucuya filter[type]=SUPPLIER, fason sorulmaz; 'Fason' → yalnız fason", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    subsGetAll.mockClear();
    await userEvent.click(roleTrigger(dialog));
    await userEvent.click(await screen.findByRole("option", { name: "Tedarikçi" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", type: "SUPPLIER" } })));
    await waitFor(() => expect(within(dialog).queryByText("Boyahane Ltd")).toBeNull());
    expect(within(dialog).getByText("İplik A.Ş.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(subsGetAll).not.toHaveBeenCalled();
    listCursor.mockClear();
    await userEvent.click(roleTrigger(dialog));
    await userEvent.click(await screen.findByRole("option", { name: "Fason" }));
    await within(dialog).findByText("Boyahane Ltd");
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(listCursor).not.toHaveBeenCalled();
    expect(roleTrigger(dialog)).toHaveTextContent("Fason");
  });

  it("(2b) ⭐ rol KLAVYE ile: tetik odak → ↓ (açılır) → ↓ → Enter = 'Müşteri' → filter[type]=CUSTOMER", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    roleTrigger(dialog).focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", type: "CUSTOMER" } })));
    await within(dialog).findByText("Yalnız Müşteri");
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(roleTrigger(dialog)).toHaveTextContent("Müşteri");
  });

  it("(3) arama sunucuya (iki bacak)", async () => {
    const dialog = await openModal();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Tedarikçi ara" }), "Boya");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ search: "Boya" })));
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ search: "Boya" })));
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(within(dialog).getByText("Boyahane Ltd")).toBeInTheDocument();
  });

  it("(4b) ⭐ seçili kayıt id'den çözülür ve tetik 'Ad — KOD' basar (C3: ad önce, dar kutuda kod adı yemez)", async () => {
    vi.mocked(subcontractorService.getById).mockResolvedValue({ success: true, data: { id: "s1", code: "FAS1", name: "Boyahane Ltd" } } as never);
    renderWithProviders(<SupplierSelect value={{ kind: "SUBCONTRACTOR", id: "s1" }} onChange={() => {}} modalPicker />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Tedarikçi seç (liste)" })).toHaveTextContent("Boyahane Ltd — FAS1"));
    expect(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }).textContent).not.toMatch(/^FAS1/);
  });

  it("(4) ⭐ satıra tıkla → onChange({kind,id}) ve kapanır", async () => {
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByText("Boyahane Ltd"));
    expect(onChange).toHaveBeenCalledWith({ kind: "SUBCONTRACTOR", id: "s1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("(5) ⭐ ALL'da TEK sorgu, sıralı bacak: cari sayfaları cursor ile biter, sonra fason sayfası 1 → 2", async () => {
    // Sayfalar AĞ GİBİ gecikmeli döner: jsdom'da IO tetiklenmez, kısa-liste koruması `isFetchingNext`in
    // true→false geçişiyle bir tur daha yükler; anında çözülen mock o ara durumu atlar (gerçek ağda olmaz).
    const gec = <T,>(v: Promise<T>) => new Promise<T>((res) => setTimeout(() => res(v), 5));
    listCursor.mockImplementation((p: { cursor?: string | null }) => gec(p.cursor === "c2" ? cursorPage([CUSTOMERS[2]]) : cursorPage(CUSTOMERS.slice(0, 2), "c2")));
    subsGetAll.mockImplementation((p: { page: number }) => gec(p.page === 1 ? offsetPage(SUBS, 1, 2) : offsetPage([{ ...SUBS[0], id: "s2", code: "FAS2", name: "İkinci Fason" }], 2, 2)));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    // kısa liste koruması / sentinel: jsdom'da IO tetiklenmez ama ilk sayfa akışı token'ı takip eder
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: "c2" })), { timeout: 4000 });
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })), { timeout: 4000 });
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })), { timeout: 4000 });
    await within(dialog).findByText("İkinci Fason", {}, { timeout: 4000 });
    expect(within(dialog).getByText("Yüklü 5 kayıt")).toBeInTheDocument();
    const names = within(dialog).getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[1]?.textContent);
    expect(names).toEqual(["İplik A.Ş.", "Hem Alır Hem Satar", "Yalnız Müşteri", "Boyahane Ltd", "İkinci Fason"]);
  });

  it("(6) ⭐ tek bacak 500 → uyarı + öbür bacak listelenir", async () => {
    listCursor.mockImplementation(() => Promise.reject(new Error("500")));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Boyahane Ltd");
    expect(within(dialog).getByText(/Cari kartlar listelenemedi — yalnız fason firmalar görünüyor/)).toBeInTheDocument();
    expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull();
  });

  it("(7) ⭐ kaynak taraması: modal ağacında yerleşik <select>/<option> yok; DataTable/useReactTable/pagination cast yok; iki sorgu yok", () => {
    const dir = path.resolve(__dirname);
    // Yorumlar ÖNCE soyulur — başlık yorumu "yerleşik <select> yok" der, o bir ihlal değildir.
    const soy = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const modal = soy(readFileSync(path.join(dir, "SupplierPickerModal.tsx"), "utf8"));
    const hook = soy(readFileSync(path.join(dir, "useSupplierPickerData.ts"), "utf8"));
    expect(modal).not.toMatch(/<select\b|<option\b/);
    expect(modal + hook).not.toMatch(/DataTable|useReactTable|DataTablePagination|as unknown as/);
    expect((hook.match(/useInfiniteQuery\(/g) ?? []).length).toBe(1);
    expect(modal).toMatch(/from "@\/components\/ui\/select"/);
    expect(modal).toMatch(/useInfiniteScroll\(/);
  });

  it("boş liste yönlendirme; modalPicker'sız kutu bayt bayt (combobox)", async () => {
    listCursor.mockImplementation(() => cursorPage([]));
    subsGetAll.mockImplementation(() => offsetPage([]));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    await within(await screen.findByRole("dialog")).findByText(SUPPLIER_PICKER_EMPTY);
  });
});
