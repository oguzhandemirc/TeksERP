// =============================================================================
// BEKÇİ — Cariler ekranının iki-kaynaklı sayfalaması
// =============================================================================
// ⭐ HİÇBİR KART KAYBOLMAZ: her kayıt tam olarak BİR sayfada çıkar (iki kaynak
//    bağımsız sayfalanır; sıralama sayfa içidir ve bu bilinçli bedeldir).
// ⭐ SÜZME SUNUCUDA: rol seçimi sorgu planına çevrilir; "Fason" seçiliyken
//    müşteri ucu HİÇ çağrılmaz. İstemcide süzmek yalnız o anki sayfayı süzer
//    ve kullanıcı "kayıt yok" sanardı.
// ⭐ `hasNext` VEYA'dır: biri bitip diğeri devam ederse sayfa hâlâ var.
// =============================================================================
import { describe, it, expect } from "vitest";
import { CARI_ROLE_FILTER_OPTIONS, cariPageInfo, cariQueryPlan, mergeCariRows, type CariMergeRow } from "./carilerPaging";
import { SUPPLIER_ROLE_LABEL } from "@/components/forms/supplierPicker";
import { companyTypeLabels } from "@/types/enums";

describe("cariQueryPlan", () => {
  it("rol seçilmemişse iki kaynak da çekilir, tür süzgeci yok", () => {
    expect(cariQueryPlan("")).toEqual({ customers: true, subcontractors: true });
  });

  it("⭐ Fason seçiliyken müşteri ucu HİÇ çağrılmaz", () => {
    expect(cariQueryPlan("SUBCONTRACTOR")).toEqual({ customers: false, subcontractors: true });
  });

  it("⭐ müşteri rolleri `filter[type]` ile SUNUCUDA süzülür", () => {
    expect(cariQueryPlan("SUPPLIER")).toEqual({
      customers: true,
      subcontractors: false,
      companyType: "SUPPLIER",
    });
    expect(cariQueryPlan("CUSTOMER").companyType).toBe("CUSTOMER");
    expect(cariQueryPlan("BOTH").companyType).toBe("BOTH");
  });

  it("müşteri rolü seçiliyken fason ucu çağrılmaz (boş dönecek istek atılmaz)", () => {
    expect(cariQueryPlan("CUSTOMER").subcontractors).toBe(false);
  });

  it("⭐ süzgeç DEĞERİ enum anahtarı, ETİKET tek kaynaktan (`companyTypeLabels` → `SUPPLIER_ROLE_LABEL`)", () => {
    expect(CARI_ROLE_FILTER_OPTIONS.map((o) => o.value)).toEqual(["", "CUSTOMER", "SUPPLIER", "BOTH", "SUBCONTRACTOR"]);
    const label = (v: string) => CARI_ROLE_FILTER_OPTIONS.find((o) => o.value === v)?.label;
    expect(label("")).toBe("Tüm roller");
    expect(label("BOTH")).toBe(companyTypeLabels.BOTH);
    expect(label("CUSTOMER")).toBe(companyTypeLabels.CUSTOMER);
    expect(label("SUPPLIER")).toBe(companyTypeLabels.SUPPLIER);
    expect(label("SUBCONTRACTOR")).toBe(SUPPLIER_ROLE_LABEL.SUBCONTRACTOR);
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
