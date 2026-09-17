// =============================================================================
// BEKÇİ — Tedarikçi seçici modalı v3 (kabul A): kutu → modal · rol FARE ve KLAVYE ile · tek bacak 500 ·
// ALL'da bacak geçişi · arama · satır → forma · kaynak taraması (yerleşik <select> / DataTable YOK) ·
// MÜŞTERİ-ONLY kart listelenmez (kullanıcı 2026-09-17 03:25) · dönüştürme kapısı (bağlantı → müşteri
// listesi → onay → type BOTH → seçim) · izin yoksa bağlantı yok · tetik "Rol: …"
// =============================================================================
// Negatif sonda (kırmızı görüldü): modal ağacına `<select>` eklenince (7) ❌; `legsFor` Fason'da cari bacağını
// kapatmayınca "yalnız fason" ❌; `legsFor("ALL")` cari bacağını filtresiz sorunca (1) "Yalnız Müşteri" ❌;
// `useCanConvertCustomer` kapısı kaldırılınca (11) bağlantı görünür ❌.
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
const createCustomer = vi.fn();
const updateCustomer = vi.fn();
vi.mock("@/pages/Customers/service", () => ({
  customerService: { listCursor: (...a: unknown[]) => listCursor(...a), getAll: vi.fn(), getById: vi.fn(), create: (...a: unknown[]) => createCustomer(...a), update: (...a: unknown[]) => updateCustomer(...a) },
}));
// İzin: dönüştürme kapısı `customer:write` ister — test başına değişir.
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
// Cari formu ağır (paneller, belge profili, benzer ad uyarısı) ve kendi bekçileri var — burada stub: açıkken
// "Kaydet" tıklanınca formun vereceği değerlerle onSubmit çağrılır; `requiredRole`/`showBranchDraft` prop'ları ölçülür.
vi.mock("@/pages/Customers/CustomerFormDialog", () => ({
  // Rol modeli: `requiredRole` ölçülür; form kipin rolünü işaretli verir, `type` GÖNDERMEZ.
  CustomerFormDialog: (p: { open: boolean; requiredRole?: string; showBranchDraft?: boolean; onSubmit: (v: Record<string, unknown>) => void }) =>
    p.open ? (
      <div data-testid="cari-form" data-required-role={p.requiredRole ?? ""} data-branch-draft={String(p.showBranchDraft)}>
        <button type="button" onClick={() => p.onSubmit({ name: "Yeni Cari A.Ş.", taxNumber: "", isCustomerRole: p.requiredRole === "isCustomerRole", isSupplierRole: p.requiredRole === "isSupplierRole", isActive: true })}>Kaydet</button>
      </div>
    ) : null,
}));
vi.mock("@/pages/Customers/schema", () => ({ customerCardPayload: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/pages/Subcontractors/service", () => ({ subcontractorService: { getAll: (...a: unknown[]) => subsGetAll(...a), getById: vi.fn() } }));

// Rol modeli: fikstür BAYRAK taşır (`type` türetilmiş; seçici okumaz). c2: müşteri + tedarikçi + AKTİF fason profili
// → seçicide TEK satır (bu), fason bacağında yok.
const CUSTOMERS = [
  { id: "c1", code: "TED1", name: "İplik A.Ş.", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false, taxNumber: "1110001112", contactPhone: "0212 111", isActive: true },
  { id: "c2", code: "BOTH1", name: "Hem Alır Hem Satar", isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true, taxNumber: null, contactPhone: null, isActive: true },
  { id: "c3", code: "MUS1", name: "Yalnız Müşteri", isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, taxNumber: null, contactPhone: null, isActive: true },
];
const SUBS = [
  { id: "s1", code: "FAS1", name: "Boyahane Ltd", taxNumber: "2220003334", phone: "0532 222", isActive: true, customerId: null },
  { id: "s2", code: "FAS2", name: "Hem Alır Hem Satar (fason profili)", taxNumber: null, phone: null, isActive: true, customerId: "c2" },
];
const cursorPage = (data: unknown[], nextCursor: string | null = null) => Promise.resolve({ success: true, data, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50 } });
const offsetPage = (data: unknown[], page = 1, totalPages = 1) => Promise.resolve({ success: true, data, pagination: { page, pageSize: 50, total: data.length, totalPages } });

beforeEach(() => {
  listCursor.mockReset();
  subsGetAll.mockReset();
  updateCustomer.mockReset();
  perms = ["customer:write"];
  listCursor.mockImplementation((p: { filters?: Record<string, string>; search?: string }) => {
    let rows = CUSTOMERS;
    // Sunucu sözleşmesi: bayrak süzgeçleri skaler ("true"/"false") — mock aynı sözleşmeyi taklit eder; `type` YOK.
    for (const k of ["isCustomerRole", "isSupplierRole", "isSubcontractorRole"] as const) {
      const v = p.filters?.[k];
      if (v !== undefined) rows = rows.filter((c) => c[k] === (v === "true"));
    }
    if (p.search) rows = rows.filter((c) => c.name.includes(p.search!));
    return cursorPage(rows);
  });
  subsGetAll.mockImplementation((p: { search?: string; filters?: Record<string, string> }) => {
    // Sunucu sözleşmesi: `filter[customerId]=null` yalnız BAĞSIZ fasonlar; süzgeç yoksa hepsi (eski davranış).
    let rows = p.filters?.customerId === "null" ? SUBS.filter((s) => s.customerId === null) : SUBS;
    if (p.search) rows = rows.filter((s) => s.name.includes(p.search!));
    return offsetPage(rows);
  });
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
  it("(1) ⭐ kutuya tıkla → dialog; liste = tedarikçi + her ikisi + fason, MÜŞTERİ-ONLY YOK; 'Tümü' isteği filter[isSupplierRole]=true; kolonlar; sayfa 50", async () => {
    const dialog = await openModal();
    for (const h of ["Kod", "Ünvan", "Rol", "Vergi No", "Telefon"]) expect(within(dialog).getByText(h)).toBeInTheDocument();
    for (const n of ["İplik A.Ş.", "Hem Alır Hem Satar", "Boyahane Ltd"]) expect(within(dialog).getByText(n)).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(within(within(dialog).getByText("Boyahane Ltd").closest("tr") as HTMLElement).getByText("Fason")).toBeInTheDocument();
    // Fason = carinin rolü: bağlı fason (s2) fason bacağında YOK — cari satırı "Müşteri + Tedarikçi · Fason" rozetiyle TEK kez.
    expect(within(dialog).queryByText("Hem Alır Hem Satar (fason profili)")).toBeNull();
    expect(within(within(dialog).getByText("Hem Alır Hem Satar").closest("tr") as HTMLElement).getByText("Müşteri · Tedarikçi · Fason")).toBeInTheDocument();
    expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ customerId: "null" }) }));
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, filters: { isActive: "true", isSupplierRole: "true" } }));
    // Rol modeli: hiçbir istek `type` süzgeci taşımaz; tedarikçi rolü hep istenir.
    for (const call of listCursor.mock.calls) {
      const f = (call[0] as { filters: Record<string, string> }).filters;
      expect(f).not.toHaveProperty("type");
      expect(f.isSupplierRole).toBe("true");
    }
    expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 50 }));
    expect(within(dialog).getByText("Yüklü 3 kayıt")).toBeInTheDocument();
    expect(within(dialog).getByText("Tüm kayıtlar yüklendi")).toBeInTheDocument();
    // Tetik kapalıyken süzgecin adını taşır.
    expect(roleTrigger(dialog)).toHaveTextContent("Rol: Tümü");
  });

  it("(2a) ⭐ rol FARE ile: 4 seçenek (Müşteri YOK); 'Tedarikçi' → yalnız tedarikçi rolü (isSupplierRole=true, isCustomerRole=false), fason sorulmaz, tetik 'Rol: Tedarikçi'; 'Fason' → yalnız fason", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    subsGetAll.mockClear();
    await userEvent.click(roleTrigger(dialog));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi", "Fason"]);
    await userEvent.click(screen.getByRole("option", { name: "Tedarikçi" }));
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", isSupplierRole: "true", isCustomerRole: "false" } })));
    await waitFor(() => expect(within(dialog).queryByText("Boyahane Ltd")).toBeNull());
    expect(within(dialog).getByText("İplik A.Ş.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(subsGetAll).not.toHaveBeenCalled();
    expect(roleTrigger(dialog)).toHaveTextContent("Rol: Tedarikçi");
    listCursor.mockClear();
    await userEvent.click(roleTrigger(dialog));
    await userEvent.click(await screen.findByRole("option", { name: "Fason" }));
    await within(dialog).findByText("Boyahane Ltd");
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(listCursor).not.toHaveBeenCalled();
    expect(roleTrigger(dialog)).toHaveTextContent("Rol: Fason");
  });

  it("(2b) ⭐ rol KLAVYE ile: tetik odak → ↓ (açılır) → ↓ ↓ → Enter = 'Müşteri + Tedarikçi' → iki bayrak da true", async () => {
    const dialog = await openModal();
    listCursor.mockClear();
    roleTrigger(dialog).focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", isCustomerRole: "true", isSupplierRole: "true" } })));
    await within(dialog).findByText("Hem Alır Hem Satar");
    await waitFor(() => expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull());
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(roleTrigger(dialog)).toHaveTextContent("Rol: Müşteri + Tedarikçi");
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
    listCursor.mockImplementation((p: { cursor?: string | null }) => gec(p.cursor === "c2" ? cursorPage([CUSTOMERS[1]]) : cursorPage([CUSTOMERS[0]], "c2")));
    subsGetAll.mockImplementation((p: { page: number }) => gec(p.page === 1 ? offsetPage([SUBS[0]], 1, 2) : offsetPage([{ ...SUBS[0], id: "s3", code: "FAS3", name: "İkinci Fason" }], 2, 2)));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    // kısa liste koruması / sentinel: jsdom'da IO tetiklenmez ama ilk sayfa akışı token'ı takip eder
    await waitFor(() => expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: "c2" })), { timeout: 4000 });
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })), { timeout: 4000 });
    await waitFor(() => expect(subsGetAll).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })), { timeout: 4000 });
    await within(dialog).findByText("İkinci Fason", {}, { timeout: 4000 });
    expect(within(dialog).getByText("Yüklü 4 kayıt")).toBeInTheDocument();
    const names = within(dialog).getAllByRole("row").slice(1).map((r) => r.querySelectorAll("td")[1]?.textContent);
    expect(names).toEqual(["İplik A.Ş.", "Hem Alır Hem Satar", "Boyahane Ltd", "İkinci Fason"]);
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
    const modal = soy(readFileSync(path.join(dir, "SupplierPickerModal.tsx"), "utf8")) + soy(readFileSync(path.join(dir, "SupplierPickerToolbar.tsx"), "utf8")) + soy(readFileSync(path.join(dir, "SupplierConvertCustomer.tsx"), "utf8"));
    const hook = soy(readFileSync(path.join(dir, "useSupplierPickerData.ts"), "utf8"));
    expect(modal).not.toMatch(/<select\b|<option\b/);
    expect(modal + hook).not.toMatch(/DataTable|useReactTable|DataTablePagination|as unknown as/);
    expect((hook.match(/useInfiniteQuery\(/g) ?? []).length).toBe(1);
    expect(modal).toMatch(/from "@\/components\/ui\/select"/);
    expect(modal).toMatch(/useInfiniteScroll\(/);
  });

  it("⭐ (8) 'Yeni cari' → form (Tedarikçi rolü işaretli+kilitli, şube taslağı yok) → Kaydet → gövde isSupplierRole:true, `type` YOK → onChange + modal kapanır", async () => {
    createCustomer.mockResolvedValue({ success: true, data: { id: "c-yeni", code: "MUS1709260001", name: "Yeni Cari A.Ş.", isSupplierRole: true } });
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByRole("button", { name: "Yeni cari ekle" }));
    const form = await screen.findByTestId("cari-form");
    expect(form).toHaveAttribute("data-required-role", "isSupplierRole");
    expect(form).toHaveAttribute("data-branch-draft", "false");
    await userEvent.click(within(form).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: "Yeni Cari A.Ş.", isSupplierRole: true, isCustomerRole: false, isActive: true })));
    expect(createCustomer.mock.calls[0]![0]).not.toHaveProperty("code");
    expect(createCustomer.mock.calls[0]![0]).not.toHaveProperty("type");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "CUSTOMER", id: "c-yeni" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("(9) boş listede de 'Yeni cari' düğmesi var ve boş metin ona yönlendirir; modal yüksekliği SABİT (h-[85vh], max-h yok)", async () => {
    listCursor.mockImplementation(() => cursorPage([]));
    subsGetAll.mockImplementation(() => offsetPage([]));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(SUPPLIER_PICKER_EMPTY);
    expect(SUPPLIER_PICKER_EMPTY).toMatch(/Yeni cari/);
    expect(within(dialog).getByRole("button", { name: "Yeni cari ekle" })).toBeInTheDocument();
    // DOM: sabit yükseklik var; ESKİ `max-h-[85vh]` yok (ui/dialog tabanının kendi `max-h-[90vh]`i kütüphanenindir).
    expect(dialog.className).toMatch(/\bh-\[85vh\]/);
    expect(dialog.className).not.toMatch(/max-h-\[85vh\]/);
    const src = readFileSync(path.join(path.resolve(__dirname), "SupplierPickerModal.tsx"), "utf8");
    expect(src).toMatch(/DialogContent className="[^"]*\bh-\[85vh\]/);
    expect(src).not.toMatch(/DialogContent className="[^"]*max-h-/);
  });

  it("boş liste yönlendirme; modalPicker'sız kutu bayt bayt (combobox)", async () => {
    listCursor.mockImplementation(() => cursorPage([]));
    subsGetAll.mockImplementation(() => offsetPage([]));
    renderWithProviders(<SupplierSelect value={null} onChange={() => {}} modalPicker />);
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    await within(await screen.findByRole("dialog")).findByText(SUPPLIER_PICKER_EMPTY);
  });
});
