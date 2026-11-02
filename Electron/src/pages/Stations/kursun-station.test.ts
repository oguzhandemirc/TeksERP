// BEKÇİ — istasyon kurşun gramaj tablosu (oie-a): tek varsayılan, pasif satır gövdede kalır, gr/m doğrulaması.
// Negatif sonda: `setDefault` diğer satırları düşürmeyince "tek varsayılan" kırmızı.
import { describe, expect, it } from "vitest";
import { addRow, buildKursunBody, moveRow, parseGramAmount, setDefault, toggleActive, type KursunStationState } from "./kursun-station";
import { defaultGramajId } from "@/lib/kursun-gramaj";

const base: KursunStationState = {
  enabled: true,
  rows: [
    { code: "40-GR", name: "40 gr", amount: "40", isActive: true, isDefault: true },
    { code: "60-GR", name: "60 gr", amount: "60", isActive: true, isDefault: false },
  ],
  gramPrice: "0,05",
  gramCurrency: "TRY",
};

describe("kurşun gramaj tablosu", () => {
  it("varsayılan TEKTİR: yeni seçilen eskisini düşürür", () => {
    const rows = setDefault(base.rows, 1);
    expect(rows.filter((r) => r.isDefault).map((r) => r.code)).toEqual(["60-GR"]);
  });
  it("varsayılana yeniden tıklamak kaldırır; pasif satır varsayılan olamaz", () => {
    expect(setDefault(base.rows, 0).some((r) => r.isDefault)).toBe(false);
    const pas = toggleActive(base.rows, 1);
    expect(setDefault(pas, 1)).toBe(pas);
  });
  it("pasife alınan varsayılanlığını kaybeder, satır silinmez", () => {
    const rows = toggleActive(base.rows, 0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ isActive: false, isDefault: false });
  });
  it("ekle + sırala", () => {
    const rows = moveRow(addRow(base.rows, " 80 gr ", "80"), 2, -1);
    expect(rows.map((r) => r.name)).toEqual(["40 gr", "80 gr", "60 gr"]);
    expect(rows[1]).toEqual({ name: "80 gr", amount: "80", isActive: true, isDefault: false });
  });
  it("gövde: pasif satır dahil tam liste, virgüllü fiyat noktaya, tek varsayılan", () => {
    const r = buildKursunBody({ ...base, rows: toggleActive(base.rows, 1) });
    expect(r.ok && r.body).toEqual({
      enabled: true, gramPrice: "0.05", gramCurrency: "TRY",
      values: [
        { code: "40-GR", name: "40 gr", amount: "40", isActive: true, isDefault: true },
        { code: "60-GR", name: "60 gr", amount: "60", isActive: false, isDefault: false },
      ],
    });
  });
  it("iki varsayılan ve geçersiz gr/m gövde kurmaz", () => {
    expect(buildKursunBody({ ...base, rows: base.rows.map((r) => ({ ...r, isDefault: true })) }).ok).toBe(false);
    expect(buildKursunBody({ ...base, rows: [{ name: "x", amount: "0", isActive: true, isDefault: false }] }).ok).toBe(false);
    expect(parseGramAmount("40,5")).toBe("40.5");
    expect(parseGramAmount("")).toBeNull();
  });
  it("kapalıyken gramaj listesi gönderilmez; fiyat boşsa para birimi de null", () => {
    const r = buildKursunBody({ ...base, enabled: false, gramPrice: "" });
    expect(r.ok && r.body).toEqual({ enabled: false, gramPrice: null, gramCurrency: null });
  });
  it("katalog ön seçimi: varsayılan varsa onu, alan yoksa hiçbirini", () => {
    expect(defaultGramajId([{ id: "a", name: "40" }, { id: "b", name: "60", isDefault: true }])).toBe("b");
    expect(defaultGramajId([{ id: "a", name: "40" }])).toBeNull();
  });
});
