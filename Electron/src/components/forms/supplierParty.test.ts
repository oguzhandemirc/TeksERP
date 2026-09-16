// =============================================================================
// BEKÇİ — TEDARİKÇİ TARAFI (C4): XOR · okuma önceliği · kısmi hata
// =============================================================================
// ⭐ ÜÇ SESSİZ HATA SINIFI kilitleniyor:
//    1. GÖVDE İKİ BACAĞI BİRDEN TAŞIRSA backend 400 verir (kullanıcı hiç kayıt
//       yapamaz); "yalnız seçilen bacağı yaz, diğerine dokunma" kısayolu ise
//       daha kötüsünü yapar — eski bacak kayıtta KALIR ve kayıt bir yüzeyde bir
//       cariyi, faturada BAŞKA bir cariyi gösterir.
//    2. OKUMA ÖNCELİĞİ ayrışırsa aynı fiş listede bir, detayda başka bir
//       tedarikçi basar.
//    3. KISMİ HATA sessiz kalırsa kullanıcı yarım listeye bakıp "firma kayıtlı
//       değil" der ve MÜKERRER KART açar.
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  SUPPLIER_KIND_TAG,
  parseSupplierPartyKey,
  sameSupplierParty,
  supplierDisplayName,
  supplierLoadNotice,
  supplierPartyKey,
  supplierPartyOf,
  supplierPartyPayload,
  supplierPartyQuery,
  supplierRefOf,
  supplierListFilters,
  supplierOptionLabel,
  toSupplierOptions,
} from "./supplierParty";

const CARI = { id: "c1", code: "M001", name: "ARZU TEKSTİL" };
const FASON = { id: "f1", code: "F001", name: "BOYER BOYA" };

describe("supplierPartyPayload — XOR", () => {
  it("⭐ müşteri-tipli caride YALNIZ supplierId gider, fason bacağı NULL'lanır", () => {
    expect(supplierPartyPayload({ kind: "CUSTOMER", id: "c1" })).toEqual({
      supplierId: "c1",
      subcontractorId: null,
    });
  });

  it("⭐ fason firmada YALNIZ subcontractorId gider, müşteri bacağı NULL'lanır", () => {
    expect(supplierPartyPayload({ kind: "SUBCONTRACTOR", id: "f1" })).toEqual({
      supplierId: null,
      subcontractorId: "f1",
    });
  });

  it("⭐ HİÇBİR ÇAĞRIDA iki bacak birden dolu olamaz (backend 400'ünün panel yüzü)", () => {
    for (const p of [
      { kind: "CUSTOMER", id: "c1" },
      { kind: "SUBCONTRACTOR", id: "f1" },
      null,
    ] as const) {
      const body = supplierPartyPayload(p);
      expect(body.supplierId !== null && body.subcontractorId !== null).toBe(false);
    }
  });

  it("seçim yoksa iki alan da null (tedarikçisiz fiş meşrudur)", () => {
    expect(supplierPartyPayload(null)).toEqual({ supplierId: null, subcontractorId: null });
    expect(supplierPartyPayload(undefined)).toEqual({ supplierId: null, subcontractorId: null });
  });
});

describe("supplierPartyQuery — liste daraltması", () => {
  it("⭐ boş anahtar HİÇ gönderilmez (sorgu anahtarı kirlenmesin)", () => {
    expect(supplierPartyQuery({ kind: "CUSTOMER", id: "c1" })).toEqual({ supplierId: "c1" });
    expect(supplierPartyQuery({ kind: "SUBCONTRACTOR", id: "f1" })).toEqual({ subcontractorId: "f1" });
    expect(supplierPartyQuery(null)).toEqual({});
  });

  it("gövde ile aynı XOR'u uygular", () => {
    const q = supplierPartyQuery({ kind: "SUBCONTRACTOR", id: "f1" });
    expect(q.supplierId).toBeUndefined();
  });
});

describe("kimlik anahtarı", () => {
  it("⭐ TÜR anahtarın parçasıdır — yalnız id taşımak tabloyu kaybettirirdi", () => {
    const key = supplierPartyKey({ kind: "SUBCONTRACTOR", id: "f1" });
    expect(parseSupplierPartyKey(key)).toEqual({ kind: "SUBCONTRACTOR", id: "f1" });
  });

  it("uuid içindeki ':' değil, İLK ayraç bölme noktasıdır", () => {
    expect(parseSupplierPartyKey("CUSTOMER:a:b")).toEqual({ kind: "CUSTOMER", id: "a:b" });
  });

  it("bozuk/yabancı anahtar null döner (sessizce müşteri sayılmaz)", () => {
    expect(parseSupplierPartyKey("c1")).toBeNull();
    expect(parseSupplierPartyKey("VENDOR:c1")).toBeNull();
    expect(parseSupplierPartyKey("CUSTOMER:")).toBeNull();
    expect(parseSupplierPartyKey("")).toBeNull();
  });

  it("sameSupplierParty AYNI id + FARKLI tür'ü eşit saymaz", () => {
    expect(sameSupplierParty({ kind: "CUSTOMER", id: "x" }, { kind: "SUBCONTRACTOR", id: "x" })).toBe(false);
    expect(sameSupplierParty({ kind: "CUSTOMER", id: "x" }, { kind: "CUSTOMER", id: "x" })).toBe(true);
    expect(sameSupplierParty(null, null)).toBe(true);
    expect(sameSupplierParty(null, { kind: "CUSTOMER", id: "x" })).toBe(false);
  });
});

describe("okuma — dolu bacak basılır", () => {
  it("⭐ müşteri bacağı doluysa o basılır", () => {
    const rec = { supplier: CARI, subcontractorSupplier: null };
    expect(supplierPartyOf(rec)).toEqual({ kind: "CUSTOMER", id: "c1" });
    expect(supplierDisplayName(rec)).toBe("ARZU TEKSTİL");
    expect(supplierRefOf(rec)?.kind).toBe("CUSTOMER");
  });

  it("⭐ fason bacağı doluysa o basılır (kolon boş kalmaz)", () => {
    const rec = { supplier: null, subcontractorSupplier: FASON };
    expect(supplierPartyOf(rec)).toEqual({ kind: "SUBCONTRACTOR", id: "f1" });
    expect(supplierDisplayName(rec)).toBe("BOYER BOYA");
    expect(supplierRefOf(rec)?.kind).toBe("SUBCONTRACTOR");
  });

  it("⭐ ÖNCELİK backend'in Excel çıkışıyla AYNI: supplier → subcontractorSupplier", () => {
    // Veri anomalisi (XOR bozulmuş): iki yüzey aynı cevabı vermeli, yoksa liste
    // ile detay aynı fiş için farklı tedarikçi basar.
    const rec = { supplier: CARI, subcontractorSupplier: FASON };
    expect(supplierDisplayName(rec)).toBe("ARZU TEKSTİL");
  });

  it("tedarikçisiz kayıt null/'—' döner (eski fişlerin görünümü korunur)", () => {
    expect(supplierPartyOf({ supplier: null, subcontractorSupplier: null })).toBeNull();
    expect(supplierDisplayName({})).toBe("—");
    expect(supplierDisplayName(null)).toBe("—");
    expect(supplierRefOf(undefined)).toBeNull();
  });

  it("⭐ ROZET yalnız fason bacağında — bugünkü satırlar bayt bayt aynı kalır", () => {
    expect(SUPPLIER_KIND_TAG.CUSTOMER).toBe("");
    expect(SUPPLIER_KIND_TAG.SUBCONTRACTOR).toBe("Fason");
  });
});

describe("seçenek listesi", () => {
  it("⭐ kod varsa 'Ad — KOD' (ad ÖNCE; C3: dar kutuda kod adı yiyordu), yoksa yalnız ad", () => {
    const opts = toSupplierOptions("CUSTOMER", [CARI, { id: "c2", name: "KODSUZ" }]);
    expect(opts[0]?.label).toBe("ARZU TEKSTİL — M001");
    expect(opts[1]?.label).toBe("KODSUZ");
    expect(opts.every((o) => o.kind === "CUSTOMER")).toBe(true);
  });

  it("boş/eksik liste patlamaz", () => {
    expect(toSupplierOptions("SUBCONTRACTOR", undefined)).toEqual([]);
  });
});

describe("supplierLoadNotice — 'hata' ile 'sonuç yok' ayrı cümleler", () => {
  const base = { customersError: false, subcontractorsError: false, loading: false };

  it("her şey yolundaysa cümle basılmaz (gürültü yok)", () => {
    expect(supplierLoadNotice(base)).toBeNull();
  });

  it("⭐ KISMİ HATA SÖYLENİR — yarım liste sessizce 'kayıt yok' okunmasın", () => {
    const n = supplierLoadNotice({ ...base, subcontractorsError: true });
    expect(n?.tone).toBe("warn");
    expect(n?.message).toMatch(/Fason firmalar listelenemedi/);
    expect(n?.message).toMatch(/AÇMAYIN/);

    const m = supplierLoadNotice({ ...base, customersError: true });
    expect(m?.message).toMatch(/Cari kartlar listelenemedi/);
  });

  it("⭐ İKİSİ DE düşerse 'kayıt yok DEĞİLDİR' denir (isError sınıfı)", () => {
    const n = supplierLoadNotice({ ...base, customersError: true, subcontractorsError: true });
    expect(n?.tone).toBe("error");
    expect(n?.message).toMatch(/DEMEK DEĞİLDİR/);
  });

  it("⭐ YÜKLENİRKEN 'alınamadı' DENMEZ (henüz cevap yok)", () => {
    expect(
      supplierLoadNotice({ customersError: true, subcontractorsError: true, loading: true }),
    ).toBeNull();
  });
});

describe("supplierListFilters — YAZMA ile FİLTRE aynı kapsamı PAYLAŞMAZ", () => {
  it("⭐ yazma bağlamı yalnız AKTİF kayıt ister (backend pasifi zaten reddeder)", () => {
    expect(supplierListFilters(false)).toEqual({ isActive: "true" });
  });

  it("⭐⭐ FİLTRE bağlamında `isActive` süzgeci DÜŞER — kapatılan firmanın geçmişi kilitlenmez", () => {
    // Sezon sonunda pasifleştirilen tedarikçinin GEÇMİŞ siparişleri duruyor ve
    // aranabilmeli. Aktif süzgeci burada kalsaydı satın almacı o firmayı
    // "Tüm tedarikçiler" kutusunda hiç göremez, siparişlerini yalnız serbest
    // metin aramasıyla bulabilirdi. Emsal karar aynı depoda yazılı:
    // `Finance/Allocations/service.cariPickerService` `isActive`ı siliyor.
    expect(supplierListFilters(true)).toEqual({});
    expect(Object.keys(supplierListFilters(true))).not.toContain("isActive");
  });
});

describe("supplierOptionLabel — pasif kayıt LİSTELENİR ama İŞARETLENİR", () => {
  it("aktif kayıt 'Ad — KOD' etiketiyle çizilir (C3: ad önce); `isActive` gelmezse de aynı", () => {
    expect(supplierOptionLabel({ ...CARI, isActive: true })).toBe("ARZU TEKSTİL — M001");
    // Alan hiç gelmezse de aynı: `supplier` bacağı `isActive` taşımaz.
    expect(supplierOptionLabel(CARI)).toBe("ARZU TEKSTİL — M001");
  });

  it("⭐ pasif kayıt '(pasif)' ile ayrılır — sessizce seçilebilir görünmesin", () => {
    // Listelemek ile 'normal göstermek' aynı şey değil: işaretsiz bir pasif
    // satır YAZMA bağlamında seçilebilir sanılır ve red KAYDET'e kadar görünmez.
    expect(supplierOptionLabel({ ...FASON, isActive: false })).toBe("BOYER BOYA — F001 (pasif)");
    const opts = toSupplierOptions("SUBCONTRACTOR", [{ ...FASON, isActive: false }]);
    expect(opts[0]?.label).toMatch(/\(pasif\)$/);
    // ⚠️ İşaret yalnız ETİKETTE — kimlik alanları kirletilmez (seçim geri
    // okunurken ad üzerinden eşleşen bir yol doğarsa "(pasif)" ekini yerdi).
    expect(opts[0]?.name).toBe("BOYER BOYA");
    expect(opts[0]?.id).toBe("f1");
  });
});
