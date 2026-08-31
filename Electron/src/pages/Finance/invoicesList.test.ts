// =============================================================================
// BEKÇİ — fatura listesi sayacı + kırpma bandı
// =============================================================================
// ⭐⭐ SAYAÇ **SUNUCUDAN** GELİR, yüklenen sayfadan DEĞİL. İlk yazımda sayfadan
//    sayılıyordu ve rozet tam da var oluş sebebi olan taslakları göremiyordu:
//    otomatik alış taslağı `issueDate = fişin tarihi` ile (geriye tarihli)
//    doğar, liste ise `issueDate desc` sıralı 100 satırdır → üç hafta önceki
//    fişten bugün doğan taslak ilk sayfaya hiç girmez ve rozet sessizce
//    sıfırlanırdı ("onay bekleyen yok" yalanı).
// ⭐ Rozet yalnız gerçekten taslak VARKEN çizilir; durum süzgeci TASLAK'ken
//    hiç çizilmez (totoloji).
// ⭐ KIRPMA SESSİZ KALMAZ: 100'lük sunucu sayfası dolduğunda kullanıcı,
//    bulamadığı faturayı "yok" sayıp ikinci kez kesmemeli.
//
// NEGATİF SONDA (2026-08-15 — koşuldu, kırmızı görüldü): `draftBadgeText`
// yeniden satır sayan hâline döndürüldü → "yüklenen sayfa taslak taşımasa da
// sunucu sayısı basılır" kontrolü KIRMIZI.
// =============================================================================
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { draftBadgeText, draftCountOf, trimNotice } from "./invoicesList";

const rows = [
  { status: "DRAFT" },
  { status: "CONFIRMED" },
  { status: "DRAFT" },
  { status: "CANCELLED" },
];

describe("draftCountOf", () => {
  it("yalnız TASLAK satırları sayar", () => {
    expect(draftCountOf(rows)).toBe(2);
    expect(draftCountOf([])).toBe(0);
  });
});

describe("draftBadgeText", () => {
  it("sunucudan gelen KESİN sayı basılır", () => {
    expect(draftBadgeText(2, "")).toBe("2 taslak");
  });

  it("⭐⭐ sayı SUNUCUDAN gelir — yüklenen sayfada hiç taslak olmasa bile basılır", () => {
    // Saha vakası: 412 faturalı firmada geriye tarihli otomatik taslak ilk 100
    // satıra girmiyor. Rozetin kaynağı sayfa olsaydı burada `null` dönerdi.
    expect(draftBadgeText(7, "")).toBe("7 taslak");
    // Sayfadan sayan eski yüklem bu senaryoda 0 üretirdi — kontrast:
    expect(draftCountOf([{ status: "CONFIRMED" }])).toBe(0);
  });

  it("⭐ taslak yokken rozet ÇİZİLMEZ ('0 taslak' gürültüdür)", () => {
    expect(draftBadgeText(0, "")).toBeNull();
  });

  it("⭐ sayı HENÜZ BİLİNMİYORSA rozet ÇİZİLMEZ (yükleniyor/hata ≠ sıfır)", () => {
    expect(draftBadgeText(undefined, "")).toBeNull();
  });

  it("⭐ durum süzgeci TASLAK iken rozet ÇİZİLMEZ (listenin tamamı taslak)", () => {
    expect(draftBadgeText(5, "DRAFT")).toBeNull();
  });

  it("başka bir durum süzgeci varken sayaç yine sunucudan gelir", () => {
    expect(draftBadgeText(3, "CONFIRMED")).toBe("3 taslak");
  });
});

// ⚠️ SAF KATMAN TEK BAŞINA YETMEZ: imza artık `number` olduğu için sayfayı
// `draftBadgeText(draftCountOf(rows), status)` diye geri bağlamak DERLENİR ve
// hiçbir saf test kırmızı vermez — yani düzeltilen hata sessizce geri gelir.
// Kaynak taraması o dikişi kilitler (backend bekçilerindeki desen).
describe("InvoicesPage kablosu — sayı SUNUCUDAN gelir", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "./InvoicesPage.tsx"),
    "utf8",
  );

  it("körlük zemini: dosya okundu ve rozeti gerçekten kuruyor", () => {
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain("draftBadgeText(");
  });

  it("⭐ rozet `pagination.total`dan beslenir (yüklenen satırlardan DEĞİL)", () => {
    const call = /draftBadgeText\(([^)]*)\)/.exec(src)?.[1] ?? "";
    expect(call, "draftBadgeText çağrısı bulunamadı").not.toBe("");
    expect(call).toContain("pagination");
    expect(call).not.toMatch(/\brows\b/);
    expect(call).not.toContain("draftCountOf");
  });

  it("⭐ sayacın kendi sorgusu TASLAĞA sabitlenmiş (kapsam kuralı)", () => {
    expect(src).toContain('status: "DRAFT"');
  });
});

describe("trimNotice", () => {
  it("⭐ toplam gösterilenden büyükse bant çıkar ve İKİ SAYIYI da söyler", () => {
    const t = trimNotice(412, 100);
    expect(t).toContain("412");
    expect(t).toContain("100");
  });

  it("liste tamamen gösteriliyorsa bant YOK", () => {
    expect(trimNotice(42, 42)).toBeNull();
    expect(trimNotice(7, 100)).toBeNull();
  });

  it("toplam bilinmiyorsa (eski backend / eksik alan) bant YOK — uydurma yok", () => {
    expect(trimNotice(undefined, 100)).toBeNull();
    expect(trimNotice(0, 0)).toBeNull();
  });
});
