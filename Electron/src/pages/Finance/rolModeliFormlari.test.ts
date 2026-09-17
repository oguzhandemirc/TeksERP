// =============================================================================
// BEKÇİ — Muhasebe formlarında taraf yalnız KART (rol modeli faz 2, dilim F; kullanıcı bulgusu 02:10)
// =============================================================================
// Ödeme/Tahsilat · Fatura · Çek girişi · Çek ciro: "Cari türü: Müşteri / Fason firma" seçimi ve fason PROFİL araması
// KALKTI — taraf cari seçici modalı (`CustomerPickerField` cari kipi: her rol, yalnız aktif kart) ve gövde yalnız
// `customerId` taşır (`subcontractorId` panelden hiç gitmez; eski istemci yolu backend'de). Cari Hesaplar süzgeci
// `kind` yerine kartın rol çifti (Yön × Fason). Kaynak taraması: geri gelen literal burada kırmızıdır.
// Negatif sonda (kırmızı görüldü): `PaymentFormDialog`a `subcontractorId: null` gövde satırı geri konunca §1 ❌;
// `CariPage`ye `<option value="SUBCONTRACTOR">` geri konunca §3 ❌.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { legsFor, firstPageToken, nextPageToken, PICKER_ROLE_DEFAULTS } from "@/components/forms/supplierPicker";
import { pickerDirectionOptions } from "@/lib/partnerRoles";
import { cariRoleLabel } from "./service";

const oku = (rel: string) => readFileSync(resolve(process.cwd(), "src/pages/Finance", rel), "utf8");
const YENI_KAYIT_FORMLARI = ["PaymentFormDialog.tsx", "Cheques/ChequeFormDialog.tsx", "Cheques/ChequeActionDialog.tsx"];
const TUM_FORMLAR = [...YENI_KAYIT_FORMLARI, "InvoiceFormDialog.tsx"];

describe("muhasebe formları — taraf yalnız kart", () => {
  it("⭐ §1 yeni kayıt formlarında `subcontractorId` / fason profil servisi / \"Cari türü\" YOK; cari seçici VAR", () => {
    for (const f of YENI_KAYIT_FORMLARI) {
      const src = oku(f);
      expect(src, f).not.toMatch(/subcontractorId|toSubcontractorId|subcontractorService|Cari türü|Fason firma ara/);
      expect(src, f).toMatch(/CustomerPickerField variant="cari"/);
    }
  });

  it("⭐ §2 fatura formu: \"Cari türü\" yok, cari seçici var; `subcontractorId` yalnız ESKİ hesabın salt-okunur dalında (gövdeye girmez)", () => {
    const src = oku("InvoiceFormDialog.tsx");
    expect(src).not.toMatch(/Cari türü|Fason firma ara|setSubcontractorId/);
    expect(src).toMatch(/CustomerPickerField variant="cari"/);
    // createInvoice gövdesi: `customerId,` satırı var, `subcontractorId:` anahtarı YOK
    const govde = src.slice(src.indexOf("createInvoice({"), src.indexOf("createInvoice({") + 600);
    expect(govde).toMatch(/customerId,/);
    expect(govde).not.toMatch(/subcontractorId/);
    expect(src).toMatch(/Eski fason hesabı/);
  });

  it("⭐ §3 Cari Hesaplar: `kind` süzgeci (\"Fason firmalar\") yok, Yön × Fason `LabeledSelect` var; rozet kartın rollerinden", () => {
    const src = oku("CariPage.tsx");
    expect(src).not.toMatch(/value="SUBCONTRACTOR"|Fason firmalar|kind: kind/);
    expect(src).toMatch(/LabeledSelect label="Yön"/);
    expect(src).toMatch(/LabeledSelect label="Fason"/);
    expect(cariRoleLabel({ kind: "CUSTOMER", roles: { isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: true } })).toBe("Tedarikçi · Fason");
    expect(cariRoleLabel({ kind: "SUBCONTRACTOR", roles: null })).toBe("Eski fason hesabı");
    expect(cariRoleLabel({ kind: "CUSTOMER" })).toBe("Müşteri"); // eski backend `roles` göndermez
    expect(oku("CariEditDialog.tsx")).toMatch(/cariRoleLabel\(cari\)/);
  });

  it("⭐ §4 açıklama cümleleri tek dil: müşteri/fason ayrımı metinden kalktı", () => {
    for (const f of TUM_FORMLAR) {
      const src = oku(f);
      expect(src, f).not.toMatch(/Müşteriden\/fasondan|Fasona\/müşteriye|Müşteriden alınan çek|Karşı tarafa verdiğimiz/);
    }
  });
});

describe("cari seçici kipi (her rol, yalnız kart)", () => {
  it("⭐ cari kipi: taban rol yok; Yön Cariler şeridinin süzgeci (Müşteri → role=customer, BOTH → iki bayrak); Fason bayrağı; fason bacağı ASLA", () => {
    expect(legsFor(PICKER_ROLE_DEFAULTS, "cari")).toEqual({ customers: true, subs: false, customerFilters: {} });
    expect(legsFor({ direction: "CUSTOMER", subcontractor: "ALL" }, "cari").customerFilters).toEqual({ role: "customer" });
    expect(legsFor({ direction: "SUPPLIER", subcontractor: "YES" }, "cari").customerFilters).toEqual({ role: "supplier", isSubcontractorRole: "true" });
    expect(legsFor({ direction: "BOTH", subcontractor: "NO" }, "cari").customerFilters).toEqual({ isCustomerRole: "true", isSupplierRole: "true", isSubcontractorRole: "false" });
    expect(legsFor({ direction: "ALL", subcontractor: "YES" }, "cari").subs).toBe(false);
    expect(firstPageToken(PICKER_ROLE_DEFAULTS, "cari")).toEqual({ leg: "customers", cursor: null });
    expect(nextPageToken({ token: { leg: "customers", cursor: null }, rows: [], next: null, error: false }, PICKER_ROLE_DEFAULTS, "cari")).toBeUndefined();
    expect(pickerDirectionOptions("cari").map((o) => o.label)).toEqual(["Tümü", "Müşteri", "Tedarikçi", "Müşteri + Tedarikçi"]);
  });
});
