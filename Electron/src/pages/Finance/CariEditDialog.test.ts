// =============================================================================
// BEKÇİ — cari kart düzenleme gövdesi (buildCariUpdatePayload + parse'lar)
// =============================================================================
// Bu ekranın tamamı TEK bir ayrımın üstünde duruyor: **boş ≠ sıfır**.
//   • boş vade (`null`) → yaşlandırma raporu satırı "Vadesiz" kovasına atar
//   • 0 gün          → peşin; fatura günü vadelidir, ertesi gün GECİKMİŞ sayılır
// `parseTermDays`'te tek bir `||` (ya da `?? null`) bu iki durumu birleştirir ve
// hata/log ÇIKMADAN yanlış rapor üretir — bu yüzden kural saf katmanda yaşıyor
// ve buradan kilitleniyor.
//
// İkinci kural: PATCH gövdesi `.strict()` — şemada olmayan anahtar 400 ile tüm
// isteği düşürür. (`notes` 2026-08-14 dikişiyle şemaya+okuma yoluna girdi; ilk
// yazımdaki "gövdede notes olamaz" kuralı o gün TERSİNE döndü — aşağıda "boş
// not null gider" sözleşmesi olarak yaşıyor.)
// Bir gün "eksik alan" diye eklenirse, kullanıcının hiç görmediği notu ezerdi.
//
// NEGATİF SONDA (2026-08-14, üçü de tek komut zincirinde boz→ölç→geri yükle,
// shasum ile birebirlik kanıtlandı):
//   ① `parseTermDays`'in `if (t === "") return null;` satırı `return undefined`
//      yapıldı → 4 kontrol kırmızı (exit 1).
//   ② `buildCariUpdatePayload` gövdesine `notes: null` eklendi → "gövdede notes
//      yok" kontrolü kırmızı (exit 1).
//   ③ `parseRiskLimit`'in regex'i `^([\d.]+)...` ile gevşetildi (binlik ayracı
//      kabul eder oldu) → "50.000 reddedilir" kontrolü kırmızı (exit 1).
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  buildCariUpdatePayload,
  formFromCari,
  parseRiskLimit,
  parseTermDays,
  type CariEditForm,
} from "./CariEditDialog";
import type { CariRow } from "./service";

const baseForm: CariEditForm = {
  taxOffice: "",
  defaultCurrency: "TRY",
  paymentTermDays: "",
  riskLimit: "",
  notes: "",
  isActive: true,
};

const form = (p: Partial<CariEditForm> = {}): CariEditForm => ({ ...baseForm, ...p });

const okBody = (f: CariEditForm) => {
  const r = buildCariUpdatePayload(f);
  if (!r.ok) throw new Error(`beklenmedik doğrulama hatası: ${JSON.stringify(r.errors)}`);
  return r.body;
};

describe("parseTermDays — boş ≠ sıfır", () => {
  it("boş metin → null (vadesiz), undefined DEĞİL", () => {
    expect(parseTermDays("")).toBeNull();
    expect(parseTermDays("   ")).toBeNull();
  });

  it('"0" → 0 (peşin) — boştan AYRI bir karar', () => {
    expect(parseTermDays("0")).toBe(0);
  });

  it("normal gün sayısı ve sınır değerleri kabul edilir", () => {
    expect(parseTermDays("30")).toBe(30);
    expect(parseTermDays(" 45 ")).toBe(45);
    expect(parseTermDays("3650")).toBe(3650);
  });

  it("geçersiz girdiler undefined döner — sessizce 'vadesiz'e çevrilmez", () => {
    // ⚠️ `Number()` tek başına bunların bir kısmını kabul ederdi: Number("-5")
    // = -5, Number("3.5") = 3.5, Number("1e3") = 1000.
    for (const bad of ["-5", "3.5", "3,5", "1e3", "abc", "7 gün", "3651", "٣"]) {
      expect(parseTermDays(bad), `"${bad}" reddedilmeli`).toBeUndefined();
    }
  });
});

describe("parseRiskLimit — belirsiz yazım reddedilir", () => {
  it("boş → null (limitsiz)", () => {
    expect(parseRiskLimit("")).toBeNull();
  });

  it("tam sayı aynen, virgüllü ondalık noktaya çevrilir", () => {
    expect(parseRiskLimit("50000")).toBe("50000");
    expect(parseRiskLimit("50000,50")).toBe("50000.50");
    expect(parseRiskLimit("50000.5")).toBe("50000.5");
  });

  it("binlik ayraçlı yazım REDDEDİLİR (50.000 = elli bin mi elli mi?)", () => {
    // Sessiz 1000× sapma yerine görünür hata: risk limiti uyarı üretir ve
    // yanlış büyüklükteki bir limit ya sürekli bağırır ya hiç bağırmaz.
    expect(parseRiskLimit("50.000")).toBeUndefined();
    expect(parseRiskLimit("1.234.567")).toBeUndefined();
  });

  it("3+ ondalık hane ve devasa tam kısım reddedilir (Decimal(14,2))", () => {
    expect(parseRiskLimit("10,123")).toBeUndefined();
    expect(parseRiskLimit("1234567890123")).toBeUndefined();
    expect(parseRiskLimit("999999999999,99")).toBe("999999999999.99");
  });

  it("negatif ve metin reddedilir", () => {
    expect(parseRiskLimit("-100")).toBeUndefined();
    expect(parseRiskLimit("limitsiz")).toBeUndefined();
  });
});

describe("buildCariUpdatePayload", () => {
  it("boş vade → gövdede null (alanı TEMİZLER, atlamaz)", () => {
    const body = okBody(form({ paymentTermDays: "" }));
    expect(body.paymentTermDays).toBeNull();
    // `null` ile "hiç göndermemek" backend'de farklı davranır
    // (`cari.service.ts:245` → `!== undefined` ise yazar).
    expect("paymentTermDays" in body).toBe(true);
  });

  it('"0" → gövdede 0, null DEĞİL', () => {
    expect(okBody(form({ paymentTermDays: "0" })).paymentTermDays).toBe(0);
  });

  it("vergi dairesi: boş → null, dolu → kırpılmış metin", () => {
    expect(okBody(form({ taxOffice: "   " })).taxOffice).toBeNull();
    expect(okBody(form({ taxOffice: "  Bursa Yıldırım " })).taxOffice).toBe("Bursa Yıldırım");
  });

  it("para birimi ve aktiflik aynen taşınır", () => {
    const body = okBody(form({ defaultCurrency: "EUR", isActive: false }));
    expect(body.defaultCurrency).toBe("EUR");
    expect(body.isActive).toBe(false);
  });

  it("gövde anahtar kümesi sabit — notes dahil (okuma yolu 2026-08-14'te açıldı)", () => {
    expect(Object.keys(okBody(form())).sort()).toEqual([
      "defaultCurrency",
      "isActive",
      "notes",
      "paymentTermDays",
      "riskLimit",
      "taxOffice",
    ]);
  });

  it("not: boş → null (temizler), dolu → kırpılmış metin", () => {
    expect(okBody(form()).notes).toBeNull();
    expect(okBody(form({ notes: "  mutabakat ay sonu  " })).notes).toBe("mutabakat ay sonu");
  });

  it("gövdede `.strict()` şemasında olmayan anahtar yok", () => {
    // customerId/subcontractorId PATCH'te `omit` edilmiştir → tek fazla anahtar
    // 400 ile TÜM isteği düşürür.
    const keys = Object.keys(okBody(form({ taxOffice: "X", riskLimit: "10" })));
    expect(keys).not.toContain("customerId");
    expect(keys).not.toContain("subcontractorId");
  });

  it("geçersiz vade → ok:false, istek KURULMAZ", () => {
    const r = buildCariUpdatePayload(form({ paymentTermDays: "-3" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.paymentTermDays).toBeTruthy();
  });

  it("geçersiz risk limiti → ok:false", () => {
    const r = buildCariUpdatePayload(form({ riskLimit: "50.000" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.riskLimit).toBeTruthy();
  });

  it("iki alan birden geçersizse İKİSİ de raporlanır (tek tek düzelttirme)", () => {
    const r = buildCariUpdatePayload(form({ paymentTermDays: "x", riskLimit: "y" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.paymentTermDays).toBeTruthy();
      expect(r.errors.riskLimit).toBeTruthy();
    }
  });
});

describe("formFromCari — ön-dolum", () => {
  const row = (p: Partial<CariRow> = {}): CariRow => ({
    id: "c1",
    kind: "CUSTOMER",
    code: "MUS-001",
    name: "Test A.Ş.",
    taxNumber: null,
    taxOffice: null,
    defaultCurrency: "TRY",
    paymentTermDays: null,
    riskLimit: null,
    notes: null,
    isActive: true,
    balances: [],
    ...p,
  });

  it("0 günlük vade boş kutuya DÜŞMEZ", () => {
    // `c.paymentTermDays || ""` yazılsaydı peşin cari, kaydedildiğinde sessizce
    // vadesize dönerdi — tam da raporu bozan hâl.
    expect(formFromCari(row({ paymentTermDays: 0 })).paymentTermDays).toBe("0");
  });

  it("null vade → boş kutu", () => {
    expect(formFromCari(row({ paymentTermDays: null })).paymentTermDays).toBe("");
  });

  it("tur atma: dolu kart → form → gövde, değerler korunur", () => {
    const f = formFromCari(
      row({ paymentTermDays: 45, riskLimit: 50000, taxOffice: "Nilüfer", defaultCurrency: "USD", isActive: false }),
    );
    const body = okBody(f);
    expect(body.paymentTermDays).toBe(45);
    expect(body.riskLimit).toBe("50000");
    expect(body.taxOffice).toBe("Nilüfer");
    expect(body.defaultCurrency).toBe("USD");
    expect(body.isActive).toBe(false);
  });

  it("ondalıklı risk limiti tur atmada bozulmaz", () => {
    expect(okBody(formFromCari(row({ riskLimit: 50000.5 }))).riskLimit).toBe("50000.5");
  });
});
