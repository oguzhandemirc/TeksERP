// =============================================================================
// BEKÇİ — Cari kartında fason rolü (fason = carinin rolü, 2026-09-17) · tek kayıt modeli (B18/7) · rol rozetleri
// =============================================================================
// ① rol kapalı → Fason bölümünde yalnız ipucu (Roller satırını gösterir); kategori listesi YOK, sunucuya yazım YOK
// ② rol açık + aktif profil → kod + "fason profilini düzenle" penceresi; kategori tıkı FORM değerini değiştirir,
//    profil ucuna HİÇ gitmez (Kaydet'e kadar) — İptal geri alabilsin
// ③ rol açık + profil yok → "Kaydet'e basınca profil açılır"; ③b YENİ kart (2026-11-26): rol açılır açılmaz kategori
//    listesi çizilir, seçim form değeri (kart gövdesiyle tek istekte gider); boş açıklamada kod tekrarlanmaz
// ④ senkron: değişmeyen formda niyet null; açık + profil yok → create(customerId, kart alanları formdan, kategoriler);
//    açık + pasif profil → update(isActive:true + kategoriler) — ikinci profil doğmaz; kapalı + aktif → update(isActive:false)
//    (silme yok); kapalı + profil yok → hiçbir yazım
// ⑤ Rol rozetleri bayraktan
// Negatif sonda (kırmızı görüldü): kategori bileşenine anında `update` geri konunca ② ❌; senkronda pasif profil için
// `create` çağrılınca ④ ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { CustomerSubcontractorRole, SUBCONTRACTOR_NEW_CARD_HINT, SUBCONTRACTOR_ROLE_OFF_HINT } from "./CustomerSubcontractorRole";
import { SUBCONTRACTOR_CATEGORIES_LABEL } from "./CustomerSubcontractorCategories";
import { SUBCONTRACTOR_PROFILE_EDIT_LABEL } from "./SubcontractorProfileEdit";
import { subcontractorIntentOf, syncSubcontractorRole } from "./subcontractorRoleSync";
import { customerFormDefaults, type CustomerFormValues } from "./schema";
import { partnerRoleBadges } from "@/lib/partnerRoles";
import type { Customer } from "./types";

const getAll = vi.fn();
const create = vi.fn();
const update = vi.fn();
vi.mock("@/pages/Subcontractors/service", () => ({
  subcontractorService: { getAll: (...a: unknown[]) => getAll(...a), create: (...a: unknown[]) => create(...a), update: (...a: unknown[]) => update(...a) },
}));
const catGetAll = vi.fn();
vi.mock("@/pages/SubcontractorCategories/service", () => ({
  subcontractorCategoryService: { getAll: (...a: unknown[]) => catGetAll(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
// Profil penceresinin içi kendi testinde; burada yalnız açıldığı ölçülür.
vi.mock("@/pages/Subcontractors/SubcontractorFormDialog", () => ({
  SubcontractorFormDialog: ({ open, initial }: { open: boolean; initial?: { code?: string } | null }) => (open ? <div role="dialog">profil {initial?.code}</div> : null),
}));
const CATS = [
  { id: "cat-boya", code: "BOYA", name: "Boyahane", description: null },
  { id: "cat-dev", code: "DEVERE", name: "Devere", description: null },
];

const cari = (over: Partial<Customer> = {}): Customer =>
  ({ id: "c1", code: "MUS-1", name: "Boya A.Ş.", taxNumber: "1234567890", type: "SUPPLIER", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false, contactPhone: "0212", address: "Bursa", isActive: true, createdAt: "", updatedAt: "", ...over }) as Customer;
const page = (rows: unknown[]) => Promise.resolve({ success: true, data: rows, pagination: { page: 1, pageSize: 1, total: rows.length, totalPages: 1 } });
const values = (over: Partial<CustomerFormValues> = {}): CustomerFormValues =>
  ({ ...customerFormDefaults, name: "Boya A.Ş.", taxNumber: "1234567890", contactPhone: "0212", address: "Bursa", isCustomerRole: false, isSupplierRole: true, ...over }) as CustomerFormValues;

let lastForm: { getValues: () => CustomerFormValues } | null = null;
function Harness({ customer, on }: { customer: Customer | null; on: boolean }) {
  const form = useForm<CustomerFormValues>({ defaultValues: values({ isSubcontractorRole: on }) });
  lastForm = form;
  return (
    <FormProvider {...form}>
      <CustomerSubcontractorRole customer={customer} />
    </FormProvider>
  );
}

beforeEach(() => {
  getAll.mockReset();
  create.mockReset();
  update.mockReset();
  create.mockResolvedValue({ success: true, data: { id: "s-new" } });
  update.mockResolvedValue({ success: true, data: { id: "s1" } });
  catGetAll.mockReset();
  catGetAll.mockImplementation(() => Promise.resolve({ success: true, data: CATS, pagination: { page: 1, pageSize: 500, total: CATS.length, totalPages: 1 } }));
});

describe("CustomerSubcontractorRole — Fason bölümü (form değeri)", () => {
  it("⭐ ① rol kapalı → ipucu; kategori listesi ve yazım yok", async () => {
    getAll.mockImplementation(() => page([]));
    renderWithProviders(<Harness customer={cari()} on={false} />);
    expect(await screen.findByText(SUBCONTRACTOR_ROLE_OFF_HINT)).toBeInTheDocument();
    expect(screen.queryByText(SUBCONTRACTOR_CATEGORIES_LABEL)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("⭐ ② rol açık + aktif profil → kod + profil penceresi; kategori tıkı yalnız formu değiştirir (sunucuya yazmaz)", async () => {
    getAll.mockImplementation(() => page([{ id: "s1", code: "FSN-1", isActive: true, categories: [{ categoryId: "cat-boya" }] }]));
    renderWithProviders(<Harness customer={cari({ isSubcontractorRole: true })} on />);
    const boya = await screen.findByRole("checkbox", { name: /Boyahane/ });
    await waitFor(() => expect(boya).toBeChecked());
    expect(screen.getByText("FSN-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Devere/ }));
    expect(lastForm?.getValues().subcontractorCategoryIds).toEqual(["cat-boya", "cat-dev"]);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: SUBCONTRACTOR_PROFILE_EDIT_LABEL }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("profil FSN-1");
  });

  it("③ rol açık + profil yok → 'Kaydet'e basınca profil açılır'", async () => {
    getAll.mockImplementation(() => page([]));
    renderWithProviders(<Harness customer={cari()} on />);
    expect(await screen.findByText(/Kaydet'e basınca bu kart için fason profili açılır/)).toBeInTheDocument();
  });

  it("⭐ ③b YENİ kart (customer null) + rol açık → kategori listesi HEMEN çizilir, seçim form değeri; profil sorgusu/yazımı yok", async () => {
    renderWithProviders(<Harness customer={null} on />);
    expect(await screen.findByText(SUBCONTRACTOR_NEW_CARD_HINT)).toBeInTheDocument();
    const devere = await screen.findByRole("checkbox", { name: /Devere/ });
    expect(devere).not.toBeDisabled();
    await userEvent.click(devere);
    expect(lastForm?.getValues().subcontractorCategoryIds).toEqual(["cat-dev"]);
    expect(getAll).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("açıklaması boş kategori kodu tekrar etmez ('DEVERE' satırı yok); dolu açıklama gösterilir", async () => {
    catGetAll.mockImplementation(() => Promise.resolve({ success: true, data: [...CATS, { id: "cat-z", code: "ZIMPARA", name: "Zımpara", description: "Yüzey işleme" }], pagination: { page: 1, pageSize: 500, total: 3, totalPages: 1 } }));
    renderWithProviders(<Harness customer={null} on />);
    expect(await screen.findByText("Yüzey işleme")).toBeInTheDocument();
    expect(screen.queryByText("DEVERE")).toBeNull();
    expect(screen.queryByText("BOYA")).toBeNull();
  });
});

describe("subcontractorRoleSync — Kaydet'te profil yazımı", () => {
  it("⭐ ④a değişmeyen form → niyet null; rol ya da kategori değişince niyet", () => {
    expect(subcontractorIntentOf(values({ isSubcontractorRole: false }), cari())).toBeNull();
    expect(subcontractorIntentOf(values({ isSubcontractorRole: true }), cari())).toEqual({ want: true, categoryIds: undefined });
    expect(subcontractorIntentOf(values({ isSubcontractorRole: true, subcontractorCategoryIds: ["x"] }), cari({ isSubcontractorRole: true }))).toEqual({ want: true, categoryIds: ["x"] });
  });

  it("⭐ ④b açık + profil yok → create (customerId, kart alanları formdan, kategoriler)", async () => {
    getAll.mockImplementation(() => page([]));
    await syncSubcontractorRole(cari(), values({ isSubcontractorRole: true }), { want: true, categoryIds: ["cat-boya"] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: "c1", code: "MUS-1", name: "Boya A.Ş.", taxNumber: "1234567890", phone: "0212", address: "Bursa", categoryIds: ["cat-boya"] }));
    expect(update).not.toHaveBeenCalled();
  });

  it("⭐ ④c açık + pasif profil → update(isActive:true + kategoriler); ikinci profil doğmaz", async () => {
    getAll.mockImplementation(() => page([{ id: "s1", code: "FSN-1", isActive: false }]));
    await syncSubcontractorRole(cari(), values({ isSubcontractorRole: true }), { want: true, categoryIds: ["cat-dev"] });
    expect(update).toHaveBeenCalledWith("s1", { isActive: true, categoryIds: ["cat-dev"] });
    expect(create).not.toHaveBeenCalled();
  });

  it("⭐ ④d kapalı + aktif profil → update(isActive:false) — silme yok; kapalı + profil yok → yazım yok", async () => {
    getAll.mockImplementation(() => page([{ id: "s1", code: "FSN-1", isActive: true }]));
    await syncSubcontractorRole(cari({ isSubcontractorRole: true }), values(), { want: false });
    expect(update).toHaveBeenCalledWith("s1", { isActive: false });
    update.mockClear();
    getAll.mockImplementation(() => page([]));
    await syncSubcontractorRole(cari(), values(), { want: false });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

// T1/T9: eski Müşteriler tablosunun Rol kolonu kalktı; rozet kuralı ortak yardımcıda (Cariler/seçiciler aynı kaynak).
describe("Rol rozetleri (partnerRoleBadges)", () => {
  it("⭐ ⑤ üç rol → üç rozet (Müşteri · Tedarikçi · Fason), bayraklardan; 'Müşteri + Tedarikçi' birleşik rozeti YOK", () => {
    const badges = partnerRoleBadges(cari({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: true }));
    expect(badges).toEqual(["Müşteri", "Tedarikçi", "Fason"]);
  });
  it("fason rolü false → 'Fason' rozeti YOK (profil pasifse sunucu bayrağı düşürür — bayrak tek kaynak)", () => {
    const badges = partnerRoleBadges(cari({ isSupplierRole: true, isSubcontractorRole: false, subcontractor: { id: "s1", isActive: true } } as Partial<Customer>));
    expect(badges).toEqual(["Tedarikçi"]);
  });
});
