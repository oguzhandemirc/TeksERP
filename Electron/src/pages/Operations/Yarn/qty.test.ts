// =============================================================================
// KG BİÇİMLENDİRME + MİKTAR GİRDİSİ — BEKÇİ
// =============================================================================
// Bu dosyanın kilitlediği üç kural, üçü de sahada ölçülmüş hatalardan doğdu:
//  ① Decimal STRING gelir → `String.prototype.toLocaleString` seçenekleri
//    sessizce yutar (rakam doğru, binlik/kuruş kaybolur — muhasebe/depo
//    ekranında en çok güven kaybettiren kusur).
//  ② Virgül NOKTAYA ÇEVRİLMEZ. "Yardımcı olalım" diye bir `replace(",", ".")`
//    eklenirse "1,500" sessizce 1,5 (ya da 1500) yazılır — ikisi de deftere
//    yanlış rakam yazmanın en sessiz yoludur.
//  ③ Eksi bakiye MEŞRUDUR; `isNegative` yalnız işareti söyler, kırpmaz.
// =============================================================================
import { describe, expect, it } from "vitest";
import { checkQtyInput, dayEndIso, dayStartIso, isNegative, kg } from "./qty";

describe("kg()", () => {
  it("Decimal STRING'i de sayı gibi biçimlendirir (asıl tuzak)", () => {
    // `"3324".toLocaleString(...)` seçenekleri yok sayıp "3324" döndürürdü.
    expect(kg("3324")).toBe("3.324,00 kg");
    expect(kg(3324)).toBe("3.324,00 kg");
  });

  it("ondalık tabanı 2, tavanı 3 hanedir (kolon Decimal(14,3))", () => {
    expect(kg("12.5")).toBe("12,50 kg");
    expect(kg("12.345")).toBe("12,345 kg");
    // Tavan aşılırsa defterdeki rakam ekranda yuvarlanırdı; 3 hane korunur.
    expect(kg(0.125)).toBe("0,125 kg");
  });

  it("eksi bakiyeyi OLDUĞU GİBİ basar — kırpmaz, gizlemez", () => {
    expect(kg("-40")).toContain("40,00 kg");
    expect(isNegative("-40")).toBe(true);
    expect(isNegative("0")).toBe(false);
    expect(isNegative(12)).toBe(false);
  });

  it("bilinmeyen değerde “—” basar, “0,00 kg” DEĞİL", () => {
    // Sıfır bir BAKİYEDİR; "bilinmiyor" ile karıştırılamaz.
    expect(kg(null)).toBe("—");
    expect(kg(undefined)).toBe("—");
    expect(kg("")).toBe("—");
    expect(kg("abc")).toBe("—");
    expect(kg("0")).toBe("0,00 kg");
  });
});

describe("checkQtyInput()", () => {
  it("geçerli girdiyi AYNEN geçirir (sayıya çevirmez)", () => {
    expect(checkQtyInput("250")).toEqual({ ok: true, value: "250" });
    expect(checkQtyInput(" 12.5 ")).toEqual({ ok: true, value: "12.5" });
    // Uzun ondalık: `Number()` turuna sokulsaydı kullanıcının yazdığından
    // farklı bir metin gidebilirdi.
    expect(checkQtyInput("12.345")).toEqual({ ok: true, value: "12.345" });
  });

  it("VİRGÜLÜ REDDEDER ve nokta yazımını söyler — çevirmez", () => {
    const r = checkQtyInput("12,5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toBe("COMMA");
    expect(r.hint).toContain("12.5");
    // Sessiz çevirmenin olmadığını kanıtlar: "1,500" hiçbir sayıya dönüşmez.
    const amb = checkQtyInput("1,500");
    expect(amb.ok).toBe(false);
  });

  it("eksi işareti AYRI bir hatadır — yönün türden geldiğini söyler", () => {
    const r = checkQtyInput("-5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toBe("NEGATIVE");
    expect(r.hint).toContain("Çıkış");
  });

  it("boş / sayı olmayan / sıfır girdiyi ayrı ayrı ayırt eder", () => {
    expect(checkQtyInput("")).toMatchObject({ ok: false, problem: "EMPTY" });
    expect(checkQtyInput("   ")).toMatchObject({ ok: false, problem: "EMPTY" });
    expect(checkQtyInput("12.3.4")).toMatchObject({ ok: false, problem: "NOT_A_NUMBER" });
    expect(checkQtyInput("abc")).toMatchObject({ ok: false, problem: "NOT_A_NUMBER" });
    expect(checkQtyInput("0")).toMatchObject({ ok: false, problem: "NOT_POSITIVE" });
    expect(checkQtyInput("0.000")).toMatchObject({ ok: false, problem: "NOT_POSITIVE" });
  });
});

describe("gün sınırı", () => {
  it("boş / bozuk tarihte parametre ÜRETMEZ (bir tarih uydurmaz)", () => {
    expect(dayStartIso("")).toBeUndefined();
    expect(dayEndIso("")).toBeUndefined();
    expect(dayStartIso("2026-13-01")).toBeUndefined();
    // `new Date(2026, 1, 31)` hata vermez, 3 Mart'a TAŞAR — geri okuma yakalar.
    expect(dayStartIso("2026-02-31")).toBeUndefined();
  });

  it("YEREL günün başını/sonunu üretir (UTC'ye kaydırmaz)", () => {
    const start = dayStartIso("2026-08-14");
    const end = dayEndIso("2026-08-14");
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const s = new Date(start as string);
    const e = new Date(end as string);
    expect(s.getFullYear()).toBe(2026);
    expect(s.getDate()).toBe(14);
    expect(s.getHours()).toBe(0);
    expect(e.getDate()).toBe(14);
    expect(e.getHours()).toBe(23);
    expect(e.getTime()).toBeGreaterThan(s.getTime());
  });
});
