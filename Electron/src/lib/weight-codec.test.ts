import { describe, it, expect } from "vitest";
import { parseWeight } from "./weight-codec";

describe("parseWeight (kantar — varsayılan decimals=2, scale=1)", () => {
  it("durum önekli kantar yanıtı → ağırlık", () => {
    expect(parseWeight("ST,GS,+12.34kg\r\n")).toBe(12.34);
  });
  it("baştaki sıfırlar + boşluk", () => {
    expect(parseWeight("  024.50 kg\r\n")).toBe(24.5);
  });
  it("virgüllü ondalık → noktaya çevirir", () => {
    expect(parseWeight("12,5\r\n")).toBe(12.5);
  });
  it("birden çok sayı → son pozitif (en güncel)", () => {
    expect(parseWeight("PREV 10.0 CUR 42.7\r\n")).toBe(42.7);
  });
  it("sondaki durum 0'ını atlar, geçerli ağırlığı seçer", () => {
    expect(parseWeight("12.34 0\r\n")).toBe(12.34);
  });
  it("sıfır / negatif / boş / sayısız → null", () => {
    expect(parseWeight("0\r\n")).toBeNull();
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("ERR\r\n")).toBeNull();
    expect(parseWeight("---")).toBeNull();
  });
});

describe("parseWeight — scale / decimals", () => {
  it("scale ile ölçekler (g→kg: 0.001)", () => {
    expect(parseWeight("12340\r\n", { scale: 0.001 })).toBe(12.34);
  });
  it("decimals override", () => {
    expect(parseWeight("12.345\r\n", { decimals: 1 })).toBe(12.3);
    expect(parseWeight("12.345\r\n", { decimals: 0 })).toBe(12);
  });
});
