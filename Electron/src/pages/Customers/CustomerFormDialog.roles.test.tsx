// =============================================================================
// BEKÇİ — Cari kartı formu ROL MODELİ (D3, 2026-09-17): üç kutu · gövde bayrak · `type` GÖNDERİLMEZ · en az bir rol
// =============================================================================
// ① yeni kart: Müşteri işaretli gelir, Tedarikçi boş, "Fason iş yapar" kaydettikten sonra (ipucu); Kaydet →
//    payload `isCustomerRole/isSupplierRole`, `type` YOK
// ② `requiredRole` (hızlı ekleme): o kutu işaretli + kilitli; öbürü serbest
// ③ düzenleme: kutular kartın bayraklarından; "Fason iş yapar" paneli var
// ④ şema: iki ticari kutu boş ve fason rolü yok → "En az bir rol" hatası; fason rolü varsa geçer
// ⑤ kaynak taraması: formda `EnumSelect<CompanyType>` / `companyTypeLabels` yok; başlık "Yeni Cari"
// Negatif sonda (kırmızı görüldü): payload'a `type: v.type` geri konunca ① ❌; şema refine kaldırılınca ④ ❌.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerFormDialog } from "./CustomerFormDialog";
import { buildCustomerPayload } from "./CustomersPage";
import { NO_ROLE_MESSAGE, customerFormDefaults, customerFormSchema } from "./schema";
import type { Customer } from "./types";

// Ağır alt paneller/uyarılar stub: bu bekçi yalnız rol kutularını ve gövdeyi ölçer.
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/forms/DocumentProfileSelect", () => ({ DocumentProfileSelect: () => null }));
vi.mock("./CustomerBranchesDraftField", () => ({ CustomerBranchesDraftField: () => null }));
vi.mock("./CustomerBranchesPanel", () => ({ CustomerBranchesPanel: () => null }));
vi.mock("./CustomerItemAliasesPanel", () => ({ CustomerItemAliasesPanel: () => null }));
vi.mock("./CustomerColorAliasesPanel", () => ({ CustomerColorAliasesPanel: () => null }));
vi.mock("./CustomerTemplateRoutesPanel", () => ({ CustomerTemplateRoutesPanel: () => null }));
vi.mock("./CustomerStandaloneLabelsPanel", () => ({ CustomerStandaloneLabelsPanel: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));
vi.mock("./CustomerSubcontractorRole", async (orig) => ({ ...(await orig<typeof import("./CustomerSubcontractorRole")>()), CustomerSubcontractorRole: (p: { customer: { isSupplierRole: boolean } }) => <div data-testid="fason-paneli" data-supplier={String(p.customer.isSupplierRole)} /> }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useCustomerBranchesEnabled: () => false, usePricingEnabled: () => false }));

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("CustomerFormDialog — rol modeli", () => {
  it("⭐ ① yeni kart: Müşteri işaretli, Tedarikçi boş; Kaydet → gövde bayrak, `type` YOK", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<CustomerFormDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText("Yeni Cari")).toBeInTheDocument();
    expect(box("Müşteri")).toBeChecked();
    expect(box("Tedarikçi")).not.toBeChecked();
    expect(screen.getByText(/Fason iş yapar kaydettikten sonra/)).toBeInTheDocument();
    expect(screen.queryByTestId("fason-paneli")).toBeNull();
    await userEvent.type(document.getElementById("name") as HTMLInputElement, "Boya A.Ş.");
    await userEvent.click(box("Tedarikçi"));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const v = onSubmit.mock.calls[0]![0];
    expect(v).toMatchObject({ isCustomerRole: true, isSupplierRole: true, isSubcontractorRole: false });
    const payload = buildCustomerPayload(v, null) as Record<string, unknown>;
    expect(payload).toMatchObject({ isCustomerRole: true, isSupplierRole: true });
    expect(payload).not.toHaveProperty("type");
    expect(payload).not.toHaveProperty("isSubcontractorRole");
  });

  it("⭐ ② requiredRole=isSupplierRole (tedarikçi seçicisinden): Tedarikçi işaretli + kilitli, Müşteri boş ve serbest", () => {
    renderWithProviders(<CustomerFormDialog open onOpenChange={() => {}} onSubmit={() => {}} requiredRole="isSupplierRole" />);
    expect(box("Tedarikçi")).toBeChecked();
    expect(box("Tedarikçi")).toBeDisabled();
    expect(box("Müşteri")).not.toBeChecked();
    expect(box("Müşteri")).not.toBeDisabled();
  });

  it("③ düzenleme: kutular kartın bayraklarından; fason paneli Tedarikçi kutusunun O ANKİ değerini görür", async () => {
    const initial = { id: "c1", code: "MUS1", name: "X", taxNumber: null, type: "SUPPLIER", isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true, exportCode: null, address: null, city: null, district: null, country: null, contactName: null, contactPhone: null, email: null, notes: null, isActive: true, createdAt: "", updatedAt: "" } as Customer;
    renderWithProviders(<CustomerFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={initial} />);
    expect(screen.getByText("Cari Kartını Düzenle")).toBeInTheDocument();
    expect(box("Müşteri")).not.toBeChecked();
    expect(box("Tedarikçi")).toBeChecked();
    expect(screen.getByTestId("fason-paneli")).toHaveAttribute("data-supplier", "true");
    await userEvent.click(box("Tedarikçi"));
    expect(screen.getByTestId("fason-paneli")).toHaveAttribute("data-supplier", "false");
  });

  it("⭐ ④ şema: hiç rol → 'En az bir rol'; yalnız fason rolü → geçer; yalnız Tedarikçi → geçer", () => {
    const base = { ...customerFormDefaults, name: "X" };
    const none = customerFormSchema.safeParse({ ...base, isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: false });
    expect(none.success).toBe(false);
    expect(none.success ? "" : none.error.issues.map((i) => i.message).join()).toContain(NO_ROLE_MESSAGE);
    expect(customerFormSchema.safeParse({ ...base, isCustomerRole: false, isSupplierRole: false, isSubcontractorRole: true }).success).toBe(true);
    expect(customerFormSchema.safeParse({ ...base, isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false }).success).toBe(true);
  });

  it("⑤ kaynak taraması: formda tip seçici / companyTypeLabels yok; başlıklar 'Yeni Cari' / 'Cari Kartını Düzenle'", () => {
    const src = readFileSync(resolve(__dirname, "CustomerFormDialog.tsx"), "utf8");
    expect(src).not.toMatch(/EnumSelect<CompanyType>|companyTypeLabels|name="type"/);
    expect(src).toMatch(/register\("isCustomerRole"\)/);
    expect(src).toMatch(/register\("isSupplierRole"\)/);
    expect(src).toMatch(/"Yeni Cari"/);
    const page = readFileSync(resolve(__dirname, "CustomersPage.tsx"), "utf8");
    expect(page).not.toMatch(/type:\s*v\.type/);
    // Formun içinden bir dialog satırı: kutular tek FormField'da
    expect(within(document.body).queryByText("Tip")).toBeNull();
  });
});
