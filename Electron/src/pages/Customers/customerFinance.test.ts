// BEKÇİ — kart formu Finans bölümü (saf, Z-B ①): alt nesne yalnız yazma yetkisi + modül açıkken; boş → null; para birimi boş → anahtar yok; DTO → alan; doğrulama
import { describe, expect, it } from "vitest";
import { financeFieldsFromView, financeFormDefaults, financeSubBody, riskLimitError, termDaysError } from "./customerFinance";

describe("customerFinance", () => {
  it("⭐ finance:write yok ya da modül kapalı → gövdeye alt nesne HİÇ konmaz (sunucu 403 vermez)", () => {
    const v = { financePaymentTermDays: "30", financeDefaultCurrency: "USD", financeTaxOffice: "Kadıköy", financeRiskLimit: "1500,5" };
    expect(financeSubBody(v, { canWrite: false, enabled: true })).toEqual({});
    expect(financeSubBody(v, { canWrite: true, enabled: false })).toEqual({});
    expect(financeSubBody(v, { canWrite: true, enabled: true })).toEqual({ finance: { paymentTermDays: 30, defaultCurrency: "USD", taxOffice: "Kadıköy", riskLimit: "1500.5" } });
  });
  it("boş alanlar null (temizler); para birimi boşsa anahtar konmaz (sunucu varsayılanı korur)", () => {
    expect(financeSubBody(financeFormDefaults, { canWrite: true, enabled: true })).toEqual({ finance: { paymentTermDays: null, taxOffice: null, riskLimit: null } });
  });
  it("DTO → form alanları; hesap yoksa varsayılanlar; riskLimit string Decimal", () => {
    expect(financeFieldsFromView({ paymentTermDays: 45, defaultCurrency: "EUR", taxOffice: null, riskLimit: "2500.00", isActive: true })).toEqual({ financePaymentTermDays: "45", financeDefaultCurrency: "EUR", financeTaxOffice: "", financeRiskLimit: "2500" });
    expect(financeFieldsFromView(null)).toEqual(financeFormDefaults);
  });
  it("doğrulama: vade 0..3650 tam sayı; risk ≥ 0 (virgül kabul); boş serbest", () => {
    expect(termDaysError("")).toBeNull(); expect(termDaysError("0")).toBeNull(); expect(termDaysError("3650")).toBeNull();
    expect(termDaysError("3651")).not.toBeNull(); expect(termDaysError("-1")).not.toBeNull(); expect(termDaysError("12.5")).not.toBeNull();
    expect(riskLimitError("")).toBeNull(); expect(riskLimitError("1500,50")).toBeNull(); expect(riskLimitError("-1")).not.toBeNull(); expect(riskLimitError("abc")).not.toBeNull();
  });
});
