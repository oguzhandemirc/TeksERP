import { describe, it, expect } from "vitest";
import {
  DEFAULT_SHIPMENT_ORDER_REQUIREMENT,
  DEFAULT_SHIPPING_INVOICE_MODE,
  SHIPMENT_ORDER_REQUIREMENT_OPTIONS,
  SHIPPING_INVOICE_MODE_OPTIONS,
  isShipmentOrderRequirement,
  isShippingInvoiceMode,
} from "./shipping-flags";

// =============================================================================
// Sevkiyat enum bayrakları — Electron AYNASI
// =============================================================================
// Bu dosya backend'in `SHIPMENT_ORDER_REQUIREMENTS` / `SHIPPING_INVOICE_MODES`
// kümelerinin kopyasıdır (Electron backend'i import edemez). Ayna sessiz
// ayrışır: eksik bir değer panelde HİÇ görünmez, fazla bir değer sunucudan 400
// alır ve ikisi de "kaydedilmedi" diye bir yerde YAZMAZ.
//
// ⚠️ ASIL ÇAPRAZ DOĞRULAMA BACKEND'DE: `Teks-Erp/scripts/test_feature_flag_contract.ts`
// §16 hem panel satırını (`enumKey`) hem VARSAYILANI hem de küme üyelerinin
// `updateSchema` tarafından kabul edildiğini ölçer. Buradaki testler o
// bekçinin ulaşamadığı iki şeyi kilitler: seçenek LİSTESİNİN değer kümesiyle
// birebirliği ve type-guard'ın davranışı.

describe("shipping-flags — sipariş bağı rejimi", () => {
  it("seçenek listesi TAM ve SIRALI (backend enum sırası)", () => {
    expect(SHIPMENT_ORDER_REQUIREMENT_OPTIONS.map((o) => o.value)).toEqual([
      "off",
      "warn",
      "block",
    ]);
  });

  it("varsayılan `warn` — BUGÜNKÜ davranış (siparişsiz sevk kurulur, uyarır)", () => {
    expect(DEFAULT_SHIPMENT_ORDER_REQUIREMENT).toBe("warn");
    // Varsayılan gerçekten listede mi — panel `defaultValue` etiketini oradan çözer.
    expect(
      SHIPMENT_ORDER_REQUIREMENT_OPTIONS.some((o) => o.value === DEFAULT_SHIPMENT_ORDER_REQUIREMENT),
    ).toBe(true);
  });

  it("her seçenek KENDİNİ ANLATIR (etiket + gerekçe) — boş metin seçim ekranını süse çevirir", () => {
    for (const o of SHIPMENT_ORDER_REQUIREMENT_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(3);
      expect(o.hint.length).toBeGreaterThan(20);
    }
  });

  it("type-guard sunucudan gelen bilinmeyen metni REDDEDER (panel varsayılana düşer)", () => {
    expect(isShipmentOrderRequirement("block")).toBe(true);
    expect(isShipmentOrderRequirement("BLOCK")).toBe(false);
    expect(isShipmentOrderRequirement("bloke")).toBe(false);
    expect(isShipmentOrderRequirement(undefined)).toBe(false);
    expect(isShipmentOrderRequirement(true)).toBe(false);
  });
});

describe("shipping-flags — fatura izi rejimi", () => {
  it("seçenek listesi TAM ve SIRALI", () => {
    expect(SHIPPING_INVOICE_MODE_OPTIONS.map((o) => o.value)).toEqual(["dis", "ic", "ikisi"]);
  });

  it("varsayılan `dis` — BUGÜNKÜ davranış (elle iz serbest)", () => {
    expect(DEFAULT_SHIPPING_INVOICE_MODE).toBe("dis");
    expect(
      SHIPPING_INVOICE_MODE_OPTIONS.some((o) => o.value === DEFAULT_SHIPPING_INVOICE_MODE),
    ).toBe(true);
  });

  it("type-guard bilinmeyen metni reddeder", () => {
    expect(isShippingInvoiceMode("ikisi")).toBe(true);
    expect(isShippingInvoiceMode("ic ")).toBe(false);
    expect(isShippingInvoiceMode(null)).toBe(false);
  });
});
