// Teslim yeri (K18) saf yardımcıları — boşken gövdeye anahtar girmez (eski gövde bayt bayt aynı),
// sevkiyatın kendi carisi teslim yeri olamaz, detay satırı kayıtlı adresi kart adresine yeğler.
import { describe, expect, it } from "vitest";
import {
  DELIVERY_ADDRESS_MAX,
  EMPTY_DELIVERY_TO,
  deliveryToBody,
  deliveryToError,
  deliveryToLine,
  formatCustomerAddress,
} from "./deliveryTo";

describe("formatCustomerAddress", () => {
  it("boş parçaları atlar, virgülle birleştirir", () => {
    expect(formatCustomerAddress({ address: " Sanayi Cd. 5 ", district: "", city: "Bursa", country: null })).toBe("Sanayi Cd. 5, Bursa");
  });
  it("adres yoksa null", () => {
    expect(formatCustomerAddress({ address: " ", city: null })).toBeNull();
    expect(formatCustomerAddress(null)).toBeNull();
  });
});

describe("deliveryToBody", () => {
  it("cari yoksa boş nesne (adres yazılmış olsa bile)", () => {
    expect(deliveryToBody(EMPTY_DELIVERY_TO)).toEqual({});
    expect(deliveryToBody({ customerId: null, address: "bir adres" })).toEqual({});
  });
  it("cari + kırpılmış adres", () => {
    expect(deliveryToBody({ customerId: "b1", address: "  Boyahane yolu  " })).toEqual({ deliveryCustomerId: "b1", deliveryAddress: "Boyahane yolu" });
  });
  it("adres boşsa yalnız cari (sunucu kart adresini basar)", () => {
    expect(deliveryToBody({ customerId: "b1", address: "   " })).toEqual({ deliveryCustomerId: "b1" });
  });
});

describe("deliveryToError", () => {
  it("sevkiyatın kendi carisi teslim yeri olamaz", () => {
    expect(deliveryToError({ customerId: "c1", address: "" }, "c1")).toMatch(/kendi carisi/);
  });
  it("başka cari geçerli; boş durum hata değil", () => {
    expect(deliveryToError({ customerId: "b1", address: "" }, "c1")).toBeNull();
    expect(deliveryToError(EMPTY_DELIVERY_TO, "c1")).toBeNull();
  });
  it("adres tavanı", () => {
    expect(deliveryToError({ customerId: "b1", address: "x".repeat(DELIVERY_ADDRESS_MAX + 1) }, "c1")).toMatch(/en fazla/);
  });
});

describe("deliveryToLine", () => {
  it("teslim yeri yoksa null", () => {
    expect(deliveryToLine({ deliveryCustomer: null, deliveryAddress: null })).toBeNull();
  });
  it("kayıtlı adres kart adresine yeğlenir", () => {
    expect(deliveryToLine({ deliveryCustomer: { name: "Boyahane A", address: "Kart adresi" }, deliveryAddress: "Özel adres" })).toBe("Boyahane A — Özel adres");
  });
  it("kayıtlı adres yoksa kart adresi; o da yoksa yalnız ad", () => {
    expect(deliveryToLine({ deliveryCustomer: { name: "Boyahane A", address: "Kart adresi" } })).toBe("Boyahane A — Kart adresi");
    expect(deliveryToLine({ deliveryCustomer: { name: "Boyahane A", address: null } })).toBe("Boyahane A");
  });
});
