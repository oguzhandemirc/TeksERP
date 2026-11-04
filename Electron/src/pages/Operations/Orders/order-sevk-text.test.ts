import { describe, it, expect } from "vitest";
import { OrderStatus, orderStatusLabels } from "@/types/enums";
import { ORDER_SEVK_FILTER_OPTIONS, orderSevkText, orderSevkTone } from "./order-cell-text";
import type { OrderSevk } from "./types";

// Adnan Şahin isteği (2026-11-04): sevk durumu günlük dille; "Onaylandı" gibi
// iş akışı sözcüğü kullanıcıya hiçbir yüzeyde görünmez.
const sevk = (kind: OrderSevk["kind"], text: string): OrderSevk => ({
  kind,
  text,
  shipped: 1200,
  requested: 2400,
  unit: "MT",
});

// `\b` Türkçe harfte çalışmaz (ı kelime karakteri sayılmaz) → sınırsız desen.
const JARGON = /Onaylandı|Onaylı|Beklemede|Bekliyor|Kısmi Sevk|Tamamlandı|^İptal$/;

describe("Sevk durumu metni — tek kaynak", () => {
  it("her durum değeri günlük etiketle eşlenir (sunucu cümlesi yokken)", () => {
    expect(orderStatusLabels).toEqual({
      PENDING: "Henüz onaylanmadı",
      APPROVED: "Henüz gönderilmedi",
      PARTIAL_SHIPPED: "Bir kısmı gönderildi",
      COMPLETED: "Hepsi gönderildi",
      CANCELLED: "Sipariş iptal edildi",
    });
    for (const s of Object.values(OrderStatus)) {
      expect(orderSevkText({ status: s })).toBe(orderStatusLabels[s]);
    }
  });

  it("enum'un her değerinin etiketi var ve hiçbiri iş akışı jargonu değil", () => {
    for (const s of Object.values(OrderStatus)) {
      const label = orderStatusLabels[s];
      expect(label, s).toBeTruthy();
      expect(label, s).not.toMatch(JARGON);
    }
  });

  it("kısmi sevkte sunucunun miktarlı cümlesi yazılır (BRÜT, parantezde)", () => {
    expect(
      orderSevkText({ status: "PARTIAL_SHIPPED", sevk: sevk("PARTIAL", "Bir kısmı gönderildi (1.200 / 2.400 m)") }),
    ).toBe("Bir kısmı gönderildi (1.200 / 2.400 m)");
    expect(orderSevkTone({ status: "PARTIAL_SHIPPED", sevk: sevk("PARTIAL", "x") })).toBe("progress");
  });

  it("elle kapatılan sipariş sunucu cümlesiyle: 'Sipariş elle kapatıldı (x / y m gönderildi)'", () => {
    const o = { status: "COMPLETED" as const, sevk: sevk("CLOSED", "Sipariş elle kapatıldı (1.200 / 2.400 m gönderildi)") };
    expect(orderSevkText(o)).toBe("Sipariş elle kapatıldı (1.200 / 2.400 m gönderildi)");
    expect(orderSevkTone(o)).toBe("muted");
  });

  it("onaysız ve iptal siparişte sunucunun 'Henüz gönderilmedi' cümlesi durum etiketini ezmez", () => {
    const none = sevk("NONE", "Henüz gönderilmedi");
    expect(orderSevkText({ status: "CANCELLED", sevk: none })).toBe("Sipariş iptal edildi");
    expect(orderSevkText({ status: "PENDING", sevk: none })).toBe("Henüz onaylanmadı");
    expect(orderSevkText({ status: "APPROVED", sevk: none })).toBe("Henüz gönderilmedi");
  });

  it("süzgeç seçenekleri aynı haritadan; tamamlanan kova kapatılanları da söyler", () => {
    expect(ORDER_SEVK_FILTER_OPTIONS).toEqual([
      { value: "PENDING", label: "Henüz onaylanmadı" },
      { value: "APPROVED", label: "Henüz gönderilmedi" },
      { value: "PARTIAL_SHIPPED", label: "Bir kısmı gönderildi" },
      { value: "COMPLETED", label: "Hepsi gönderildi ya da elle kapatıldı" },
      { value: "CANCELLED", label: "Sipariş iptal edildi" },
    ]);
  });
});
