// =============================================================================
// BEKÇİ — Tedarikçi seçici modalı v3, İKİNCİ DOSYA: dönüştürme kapısı ("bu müşteriden ilk kez alacağım") +
// FASON = CARİNİN ROLÜ (bağlı fason cari satırında tek kez; "Bağlı cari" seçici variant'ı). Kurulum
// `SupplierPickerModal.test.tsx` ile AYNI (mock'lar dosya başına hoist edilir; paylaşılamaz) — dosya boyut tavanı
// için bölündü (2026-09-17).
// =============================================================================
// Negatif sondalar (kırmızı görüldü): `useCanConvertCustomer` kapısı kaldırılınca (11) bağlantı görünür ❌;
// fason bacağından `UNLINKED_SUBCONTRACTOR_FILTER` kaldırılınca ana dosyada (1) "fason profili" satırı ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SupplierSelect } from "./SupplierSelect";
import { customerService } from "@/pages/Customers/service";

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

describe("SupplierPickerModal v3 — dönüştürme + fason = carinin rolü", () => {
  // ── Dönüştürme kapısı: "bu müşteriden İLK KEZ alacağım" ──────────────────────────────────────────
  it("⭐ (10) bağlantı → yalnız müşteri-only liste (isCustomerRole=true & isSupplierRole=false, fason yok, rol kutusu yok) → satır → onay metni → update(id,{isSupplierRole:true}) (type YAZILMAZ) → onChange({kind:'CUSTOMER',id}) + kapanır", async () => {
    updateCustomer.mockResolvedValue({ success: true, data: { id: "c3", name: "Yalnız Müşteri", isCustomerRole: true, isSupplierRole: true } });
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    listCursor.mockClear();
    subsGetAll.mockClear();
    await userEvent.click(within(dialog).getByRole("button", { name: "Müşteri kartını tedarikçi de yap…" }));
    await within(dialog).findByText("Yalnız Müşteri");
    expect(within(dialog).getByText("Müşteri kartını tedarikçi de yap")).toBeInTheDocument();
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", isCustomerRole: "true", isSupplierRole: "false" } }));
    expect(subsGetAll).not.toHaveBeenCalled();
    expect(within(dialog).queryByText("İplik A.Ş.")).toBeNull();
    expect(within(dialog).queryByText("Boyahane Ltd")).toBeNull();
    expect(within(dialog).queryByRole("combobox", { name: "Rol" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Yeni cari ekle" })).toBeNull();
    // Satır → onay (seçim HENÜZ yazılmadı)
    await userEvent.click(within(dialog).getByText("Yalnız Müşteri"));
    const confirm = await screen.findByRole("dialog", { name: "Kart tipi değişecek" });
    expect(within(confirm).getByText("Yalnız Müşteri kartına Tedarikçi rolü eklenecek.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(updateCustomer).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: "Dönüştür ve seç" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledWith("c3", { isSupplierRole: true }));
    expect(updateCustomer.mock.calls[0]![1]).not.toHaveProperty("type");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: "CUSTOMER", id: "c3" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Yeniden açılış: dönüştürme görünümü SIFIRLANDI — tedarikçi listesi ve rol kutusu geri (gerçek Electron'da ölçüldü)
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const again = await screen.findByRole("dialog");
    await within(again).findByText("Boyahane Ltd");
    expect(within(again).getByText("Tedarikçi seç")).toBeInTheDocument();
    expect(within(again).getByRole("combobox", { name: "Rol" })).toBeInTheDocument();
  });

  it("(10b) dönüştürme görünümünden 'Tedarikçi listesine dön' → tedarikçi listesi geri gelir", async () => {
    const dialog = await openModal();
    await userEvent.click(within(dialog).getByRole("button", { name: "Müşteri kartını tedarikçi de yap…" }));
    await within(dialog).findByText("Yalnız Müşteri");
    await userEvent.click(within(dialog).getByRole("button", { name: /Tedarikçi listesine dön/ }));
    await within(dialog).findByText("Boyahane Ltd");
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(within(dialog).getByRole("combobox", { name: "Rol" })).toBeInTheDocument();
  });

  it("⭐ (11) customer:write YOKSA bağlantı hiç çizilmez (kart tipi değiştirmek cari yazma yetkisidir)", async () => {
    perms = [];
    const dialog = await openModal();
    expect(within(dialog).queryByRole("button", { name: "Müşteri kartını tedarikçi de yap…" })).toBeNull();
    expect(within(dialog).queryByText(/ilk kez mi alacaksınız/)).toBeNull();
  });

  it("(12) dönüştürme HATA verirse seçim yazılmaz, modal açık kalır (toast apiClient'ın; burada ikinci toast yok)", async () => {
    updateCustomer.mockRejectedValue(new Error("403"));
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByRole("button", { name: "Müşteri kartını tedarikçi de yap…" }));
    await userEvent.click(await within(dialog).findByText("Yalnız Müşteri"));
    const confirm = await screen.findByRole("dialog", { name: "Kart tipi değişecek" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Dönüştür ve seç" }));
    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Kart tipi değişecek" })).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("(13) müşteri kipi DEĞİŞMEDİ: bağlantı yok (kural yalnız tedarikçi kipi), rol seçenekleri Tümü · Müşteri · Müşteri + Tedarikçi", async () => {
    const { CustomerPickerField } = await import("./CustomerPickerField");
    renderWithProviders(<CustomerPickerField value={null} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Müşteri seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Yalnız Müşteri");
    expect(within(dialog).queryByRole("button", { name: "Müşteri kartını tedarikçi de yap…" })).toBeNull();
    expect(roleTrigger(dialog)).toHaveTextContent("Rol: Tümü");
    await userEvent.click(roleTrigger(dialog));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Tümü", "Müşteri", "Müşteri + Tedarikçi"]);
  });

  // ── Fason = carinin rolü (2026-09-17) ───────────────────────────────────────────────────────────
  it("⭐ (14) bağlı fason profili olan cari satırına tıkla → onChange({kind:'CUSTOMER'}) (fason kimliği değil); bağsız fason → SUBCONTRACTOR", async () => {
    const onChange = vi.fn();
    const dialog = await openModal(onChange);
    await userEvent.click(within(dialog).getByText("Hem Alır Hem Satar"));
    expect(onChange).toHaveBeenCalledWith({ kind: "CUSTOMER", id: "c2" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Tedarikçi seç (liste)" }));
    const again = await screen.findByRole("dialog");
    await userEvent.click(await within(again).findByText("Boyahane Ltd"));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "SUBCONTRACTOR", id: "s1" });
  });

  it("⭐ (15) 'Bağlı cari' seçici (variant supplier-cari): yalnız tedarikçi rolü olan cari, fason bacağı HİÇ sorulmaz, Fason rol seçeneği yok, dönüştürme bağlantısı yok; × bağı kaldırır", async () => {
    const { CustomerPickerField } = await import("./CustomerPickerField");
    const onChange = vi.fn();
    renderWithProviders(<CustomerPickerField variant="supplier-cari" clearable value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Bağlı cari seç (liste)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bağlanacak cari kartı seç")).toBeInTheDocument();
    await within(dialog).findByText("İplik A.Ş.");
    expect(within(dialog).getByText("Hem Alır Hem Satar")).toBeInTheDocument();
    expect(within(dialog).queryByText("Yalnız Müşteri")).toBeNull();
    expect(within(dialog).queryByText("Boyahane Ltd")).toBeNull();
    expect(subsGetAll).not.toHaveBeenCalled();
    expect(listCursor).toHaveBeenCalledWith(expect.objectContaining({ filters: { isActive: "true", isSupplierRole: "true" } }));
    expect(within(dialog).queryByRole("button", { name: "Müşteri kartını tedarikçi de yap…" })).toBeNull();
    await userEvent.click(roleTrigger(dialog));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Tümü", "Tedarikçi", "Müşteri + Tedarikçi"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(dialog).getByText("İplik A.Ş."));
    expect(onChange).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // × ile bağ kaldırma (değer varken çizilir)
    vi.mocked(customerService.getById).mockResolvedValue({ success: true, data: { id: "c1", code: "TED1", name: "İplik A.Ş." } } as never);
    renderWithProviders(<CustomerPickerField variant="supplier-cari" clearable value="c1" onChange={onChange} />);
    await userEvent.click(await screen.findByRole("button", { name: "Bağı kaldır" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
