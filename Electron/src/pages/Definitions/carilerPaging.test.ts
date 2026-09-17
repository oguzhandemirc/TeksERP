// =============================================================================
// BEKÇİ — Cariler ekranının iki-kaynaklı sayfalaması
// =============================================================================
// ⭐ HİÇBİR KART KAYBOLMAZ: her kayıt tam olarak BİR sayfada çıkar (iki kaynak
//    bağımsız sayfalanır; sıralama sayfa içidir ve bu bilinçli bedeldir).
// ⭐ SÜZME SUNUCUDA: Yön × Fason seçimi sorgu planına çevrilir (tek kaynak `lib/partnerRoles`); "Yapmayan"
//    seçiliyken fason ucu HİÇ çağrılmaz. İstemcide süzmek yalnız o anki sayfayı süzer ve kullanıcı "kayıt yok" sanardı.
// ⭐ `hasNext` VEYA'dır: biri bitip diğeri devam ederse sayfa hâlâ var.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CARI_FILTER_DEFAULTS, cariPageInfo, cariQueryPlan, isCariFilterDirty, mergeCariRows, type CariMergeRow } from "./carilerPaging";
import { DIRECTION_OPTIONS, SUBCONTRACTOR_OPTIONS, partnerRoleLabels } from "@/lib/partnerRoles";

describe("cariQueryPlan — Yön × Fason (rol modeli 2026-09-17)", () => {
  it("süzgeçsiz: iki kaynak da çekilir, cari süzgeci boş (fason bacağı yalnız BAĞSIZ profiller — bağlı fason cari satırında)", () => {
    expect(cariQueryPlan(CARI_FILTER_DEFAULTS)).toEqual({ customers: true, subcontractors: true, customerFilters: {} });
    expect(isCariFilterDirty(CARI_FILTER_DEFAULTS)).toBe(false);
  });

  it("⭐ Yön → SUNUCU süzgeci tek kaynaktan (partnerRoles): Müşteri/Tedarikçi filter[role], Müşteri + Tedarikçi iki bayrak AND; yön seçiliyken fason bacağı çağrılmaz", () => {
    expect(cariQueryPlan({ direction: "SUPPLIER", subcontractor: "ALL" })).toEqual({ customers: true, subcontractors: false, customerFilters: { role: "supplier" } });
    expect(cariQueryPlan({ direction: "CUSTOMER", subcontractor: "ALL" }).customerFilters).toEqual({ role: "customer" });
    expect(cariQueryPlan({ direction: "BOTH", subcontractor: "ALL" }).customerFilters).toEqual({ isCustomerRole: "true", isSupplierRole: "true" });
    expect(cariQueryPlan({ direction: "BOTH", subcontractor: "ALL" }).customerFilters).not.toHaveProperty("type");
  });

  it("⭐ Fason yapan → cari bacağı isSubcontractorRole=true + fason bacağı (bağsız profiller); Yapmayan → fason bacağı HİÇ çağrılmaz", () => {
    expect(cariQueryPlan({ direction: "ALL", subcontractor: "YES" })).toEqual({ customers: true, subcontractors: true, customerFilters: { isSubcontractorRole: "true" } });
    expect(cariQueryPlan({ direction: "ALL", subcontractor: "NO" })).toEqual({ customers: true, subcontractors: false, customerFilters: { isSubcontractorRole: "false" } });
    expect(cariQueryPlan({ direction: "SUPPLIER", subcontractor: "YES" }).customerFilters).toEqual({ role: "supplier", isSubcontractorRole: "true" });
    expect(isCariFilterDirty({ direction: "ALL", subcontractor: "YES" })).toBe(true);
  });

  it("⭐ şerit seçenekleri etiketleri tek kaynaktan (partnerRoleLabels); eski 'Alıcı'/'type' literal'i yeni yüzeyde YOK", () => {
    expect(DIRECTION_OPTIONS.map((o) => o.label)).toEqual(["Tümü", partnerRoleLabels.customer, partnerRoleLabels.supplier, `${partnerRoleLabels.customer} + ${partnerRoleLabels.supplier}`]);
    expect(SUBCONTRACTOR_OPTIONS.map((o) => o.value)).toEqual(["ALL", "YES", "NO"]);
    const src = readFileSync(resolve(__dirname, "CarilerPage.tsx"), "utf8") + readFileSync(resolve(__dirname, "carilerPaging.ts"), "utf8");
    expect(src).not.toMatch(/Alıcı|companyTypeLabels|\btype:\s*["'](CUSTOMER|SUPPLIER|BOTH)/);
    expect(src).toMatch(/LabeledSelect/);
  });

  it("⭐ TEK giriş 'Yeni Cari': Cariler'de 'Yeni Fason' düğmesi ve bağsız fason yaratan yol YOK (fason formu yalnız düzenleme)", () => {
    const src = readFileSync(resolve(__dirname, "CarilerPage.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/Yeni Cari/);
    expect(src).not.toMatch(/Yeni Fason|subcontractorService\.create|createKind|createSubM/);
    expect(src).toMatch(/open=\{Boolean\(editSub\)\}/);
  });
});

describe("mergeCariRows", () => {
  const c = (name: string): CariMergeRow => ({ kind: "CUSTOMER", id: name, name });
  const s = (name: string): CariMergeRow => ({ kind: "SUBCONTRACTOR", id: name, name });

  it("iki kaynak tek listede ve ada göre sıralı", () => {
    const rows = mergeCariRows([c("ZEYNEP"), c("ALİ")], [s("BORA")]);
    expect(rows.map((r) => r.name)).toEqual(["ALİ", "BORA", "ZEYNEP"]);
  });

  it("⭐ Türkçe sıralama (Ç/İ ASCII sırada yanlış yere düşer)", () => {
    const rows = mergeCariRows([c("ÇINAR"), c("CEM"), c("DENİZ")], []);
    expect(rows.map((r) => r.name)).toEqual(["CEM", "ÇINAR", "DENİZ"]);
  });

  it("tek kaynak boşken diğeri aynen döner", () => {
    expect(mergeCariRows([], [s("BORA")]).map((r) => r.name)).toEqual(["BORA"]);
    expect(mergeCariRows([], [])).toEqual([]);
  });
});

describe("cariPageInfo", () => {
  const plan = { customers: true, subcontractors: true };

  it("toplam iki kaynağın toplamıdır", () => {
    expect(cariPageInfo({ page: 1, pageSize: 50, customerTotal: 520, subTotal: 12, plan }).total).toBe(532);
  });

  it("⭐ hasNext VEYA'dır — müşteriler bitse de fasonlar devam edebilir", () => {
    const info = cariPageInfo({ page: 1, pageSize: 50, customerTotal: 10, subTotal: 120, plan });
    expect(info.hasNext).toBe(true);
  });

  it("iki kaynak da bittiğinde sonraki sayfa yok", () => {
    const info = cariPageInfo({ page: 2, pageSize: 50, customerTotal: 60, subTotal: 20, plan });
    expect(info.hasNext).toBe(false);
    expect(info.hasPrev).toBe(true);
  });

  it("⭐ kapsam dışı kaynak toplama GİRMEZ (Fason süzgecinde müşteri sayısı sızmaz)", () => {
    const info = cariPageInfo({
      page: 1,
      pageSize: 50,
      customerTotal: 900,
      subTotal: 3,
      plan: { customers: false, subcontractors: true },
    });
    expect(info.total).toBe(3);
    expect(info.hasNext).toBe(false);
  });

  it("⭐ 500+ KART: eski `loadAllForPicker` duvarının olduğu yerde sayfalama çalışır", () => {
    const info = cariPageInfo({ page: 1, pageSize: 50, customerTotal: 812, subTotal: 0, plan });
    expect(info.total).toBe(812);
    expect(info.hasNext).toBe(true);
  });

  it("ilk sayfada geri yok", () => {
    expect(cariPageInfo({ page: 1, pageSize: 50, customerTotal: 5, subTotal: 5, plan }).hasPrev).toBe(false);
  });
});
