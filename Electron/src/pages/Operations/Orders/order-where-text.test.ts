// "Nerede?" + "Sevk" saf metin katmanı — tasarımın HER durumu birebir metinle.
import { describe, it, expect } from "vitest";
import { TERIM } from "@/lib/terim";
import { orderStatusLabels } from "@/types/enums";
import {
  ORDER_SHIP_FILTER_OPTIONS,
  activeWhereTab,
  normalizeFasonGun,
  orderShipText,
  orderShipView,
  orderWhereExportText,
  orderWhereView,
  stepTrailText,
  whereTabs,
  woDetailLines,
} from "./order-where-text";
import type { Order, OrderLine, OrderWhere, OrderWherePlace, OrderWhereWorkOrder } from "./types";

const where = (p: Partial<OrderWhere>): OrderWhere => ({ durum: "YERLER", yerler: [], sonHareket: null, ...p });
const asama = (ad: string, n: number): OrderWherePlace => ({ tur: "ASAMA", id: ad, ad, topSayisi: n, metre: n * 50, gun: null });
const fason = (ad: string | null, n: number, gun: number | null): OrderWherePlace => ({ tur: "FASON", id: ad, ad, topSayisi: n, metre: n * 50, gun });
const hazir = (n: number): OrderWherePlace => ({ tur: "HAZIR", id: null, ad: null, topSayisi: n, metre: n * 50, gun: null });
const view = (n: OrderWhere | null | undefined, manualClosedById: string | null = null) => orderWhereView({ nerede: n, manualClosedById });

describe("Nerede? — durum tablosu", () => {
  it.each([
    [where({ durum: "IPTAL" }), "Sipariş iptal edildi", "muted"],
    [where({ durum: "TAMAM" }), "Hepsi gönderildi", "success"],
    [where({ durum: "IE_YOK" }), `${TERIM.terbiyeIsEmri.tekil} açılmadı`, "muted"],
    [where({ durum: "BASLANMADI" }), "İşe başlanmadı", "muted"],
    [where({ durum: "GONDERILDI" }), "Üretilen toplar gönderildi", "success"],
    [where({ yerler: [asama("Ham kontrol", 12)] }), "Ham kontrol aşamasında · 12 top", "info"],
    [where({ yerler: [fason("Akın Boya", 8, 3)] }), "Fasonda – Akın Boya · 8 top · 3 gündür", "warning"],
    [where({ yerler: [fason("Akın Boya", 8, 0)] }), "Fasonda – Akın Boya · 8 top · bugün gönderildi", "warning"],
    [where({ yerler: [fason(null, 2, null)] }), "Fasonda · 2 top", "warning"],
    [where({ yerler: [hazir(5)] }), "Sevke hazır · 5 top", "success"],
    [where({ yerler: [asama("Tambur", 1200)] }), "Tambur aşamasında · 1200 top", "info"],
    [where({ yerler: [hazir(9), asama("Tambur", 4), fason("Akın Boya", 2, 1)] }), "Sevke hazır · 9 top · +2 yerde daha", "success"],
  ] as const)("%j → %s", (n, text, tone) => {
    expect(view(n)).toEqual({ text, tone });
  });

  it("hazır yerde 'paketli' sözcüğü yok (Ek karar 3)", () => {
    expect(view(where({ yerler: [hazir(3)] }))?.text).not.toMatch(/paketli/);
  });

  it("elle kapatılan tamam sipariş 'Hepsi gönderildi' demez", () => {
    expect(view(where({ durum: "TAMAM" }), "u1")).toEqual({ text: "Sipariş elle kapatıldı", tone: "muted" });
  });

  it("Excel metni ekrandaki rozet metniyle aynı; termin eki yok", () => {
    const n = where({ yerler: [fason("Akın Boya", 8, 3), hazir(1)] });
    expect(orderWhereExportText({ nerede: n, manualClosedById: null })).toBe(
      "Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha",
    );
  });

  it("alan yok (üretim kapalı / eski backend) ya da bilinmeyen durum → çizilmez, Excel '—'", () => {
    expect(view(undefined)).toBeNull();
    expect(view(null)).toBeNull();
    expect(view(where({ durum: "YENI" as OrderWhere["durum"] }))).toBeNull();
    expect(orderWhereExportText({ nerede: null, manualClosedById: null })).toBe("—");
  });

  it("YERLER ama liste boş → uydurma yer yok, 'İşe başlanmadı'", () => {
    expect(view(where({ yerler: [] }))?.text).toBe("İşe başlanmadı");
  });
});

const line = (p: Partial<OrderLine> = {}): OrderLine => ({ quantity: 1200, unit: "MT", cancelledAt: null, ...p }) as OrderLine;
const ship = (status: Order["status"], shippedQty: number, lines: OrderLine[], manualClosedById: string | null = null) =>
  orderShipText({ status, shippedQty, lines, manualClosedById });

describe("Sevk durumu — günlük dil, BRÜT sevk cümlesi", () => {
  it.each([
    ["APPROVED", 0, [line(), line()], null, "Henüz gönderilmedi"],
    ["PENDING", 0, [line()], null, "Henüz onaylanmadı"],
    ["PARTIAL_SHIPPED", 1200, [line(), line()], null, "Bir kısmı gönderildi (1200 / 2400 m)"],
    ["APPROVED", 40.5, [line({ quantity: 300 })], null, "Bir kısmı gönderildi (40,5 / 300 m)"],
    ["COMPLETED", 2400, [line(), line()], null, "Hepsi gönderildi"],
    ["PARTIAL_SHIPPED", 2400, [line(), line()], null, "Hepsi gönderildi"],
    ["COMPLETED", 1000, [line(), line()], "u1", "Sipariş elle kapatıldı (1000 / 2400 m gönderildi)"],
    ["COMPLETED", 0, [line({ unit: "KG" })], "u1", "Sipariş elle kapatıldı"],
    ["PARTIAL_SHIPPED", 0, [line({ unit: "KG" }), line()], null, "Bir kısmı gönderildi"],
    ["CANCELLED", 0, [line()], null, "Sipariş iptal edildi"],
    ["CANCELLED", 300, [line()], null, "Sipariş iptal edildi (300 / 1200 m gönderildi)"],
    ["CANCELLED", 300, [line({ unit: "KG" })], null, "Sipariş iptal edildi"],
  ] as const)("%s sevk=%s → %s", (...c) => {
    const [status, shipped, lines, closed, text] = c;
    expect(ship(status, shipped, [...lines], closed)).toBe(text);
  });

  it("her enum değerinin miktarsız metni günlük dil; 'Onaylandı' jargonu yok", () => {
    expect(orderStatusLabels).toEqual({
      PENDING: "Henüz onaylanmadı",
      APPROVED: "Henüz gönderilmedi",
      PARTIAL_SHIPPED: "Bir kısmı gönderildi",
      COMPLETED: "Hepsi gönderildi",
      CANCELLED: "Sipariş iptal edildi",
    });
    for (const status of Object.keys(orderStatusLabels) as Order["status"][]) {
      const text = ship(status, 0, [line({ unit: "KG" })]);
      expect(text).toBe(orderStatusLabels[status]);
      expect(text).not.toMatch(/Onaylandı|Onaylı|Kısmi|Tamamlandı|Beklemede/);
    }
  });

  it("renk durumla tutarlı: onaysız uyarı, iptal/kapatıldı sönük, kısmi ilerleme, hepsi başarı", () => {
    const tone = (status: Order["status"], shipped: number, closed: string | null = null) =>
      orderShipView({ status, shippedQty: shipped, lines: [line()], manualClosedById: closed }).tone;
    expect(tone("PENDING", 0)).toBe("warning");
    expect(tone("APPROVED", 0)).toBe("info");
    expect(tone("PARTIAL_SHIPPED", 600)).toBe("progress");
    expect(tone("COMPLETED", 1200)).toBe("success");
    expect(tone("COMPLETED", 600, "u1")).toBe("muted");
    expect(tone("CANCELLED", 0)).toBe("muted");
  });

  it("süzgeç seçenekleri liste metniyle aynı; 'Hepsi gönderildi' kovası kapatılanı da söyler", () => {
    expect(ORDER_SHIP_FILTER_OPTIONS).toEqual([
      { value: "PENDING", label: "Henüz onaylanmadı" },
      { value: "APPROVED", label: "Henüz gönderilmedi" },
      { value: "PARTIAL_SHIPPED", label: "Bir kısmı gönderildi" },
      { value: "COMPLETED", label: "Hepsi gönderildi ya da elle kapatıldı" },
      { value: "CANCELLED", label: "Sipariş iptal edildi" },
    ]);
  });

  it("iptal kalem yalnız sevk edilmiş kısmıyla istenene girer", () => {
    const lines = [line(), line({ cancelledAt: "2026-11-01T00:00:00Z", quantity: 5000, shippedQty: 200 })];
    expect(ship("PARTIAL_SHIPPED", 500, lines)).toBe("Bir kısmı gönderildi (500 / 1400 m)");
  });
});

const wo = (p: Partial<OrderWhereWorkOrder> = {}): OrderWhereWorkOrder => ({
  id: "w1",
  no: "IE-1",
  durum: "IN_PROGRESS",
  kumas: null,
  renk: null,
  hedefMetre: null,
  adimlar: [],
  fason: [],
  hazir: { topSayisi: 0, metre: 0 },
  gitti: { topSayisi: 0, metre: 0 },
  sonHareket: null,
  ...p,
});

describe("yan panel metinleri", () => {
  const step = (ad: string, asama: "GECTI" | "BURADA" | "SIRADA", topSayisi = 0, fasonTop = 0) =>
    ({ id: ad, ad, asama, topSayisi, metre: topSayisi * 100, fasonTop });

  it("ilerleme çizgisi işaretleri; fasondaki adımda firma + top + gün", () => {
    const w = wo({ fason: [{ firmaId: "f1", firmaAd: "Akın Boya", topSayisi: 8, metre: 800, gun: 3 }] });
    expect(stepTrailText(step("Ham kontrol", "GECTI"), w)).toBe("✓ Ham kontrol");
    expect(stepTrailText(step("Fason", "BURADA", 8, 8), w)).toBe("● Fason (Akın Boya, 8 top, 3 gündür)");
    expect(stepTrailText(step("Tambur", "BURADA", 4), w)).toBe("● Tambur (4 top)");
    expect(stepTrailText(step("Kalite", "SIRADA"), w)).toBe("○ Kalite");
  });

  it("aşama başına top + metre; topsuz adım satır olmaz", () => {
    const w = wo({
      adimlar: [step("Ham kontrol", "GECTI"), step("Tambur", "BURADA", 4)],
      fason: [{ firmaId: "f1", firmaAd: "Akın Boya", topSayisi: 8, metre: 1600, gun: 0 }],
      hazir: { topSayisi: 6, metre: 1800 },
      gitti: { topSayisi: 2, metre: 600.5 },
    });
    expect(woDetailLines(w)).toEqual([
      "Tambur: 4 top · 400 m",
      "Fasonda – Akın Boya: 8 top · 1600 m · bugün gönderildi",
      "Sevke hazır: 6 top · 1800 m",
      "Gönderildi: 2 top · 600,5 m",
    ]);
  });
});

describe("hızlı sekmeler + gün girdisi", () => {
  it("üretim kapalıyken Fasonda / Sevke hazır sekmeleri düşer", () => {
    expect(whereTabs(true).map((t) => t.label)).toEqual(["Tümü", "Bekleyenler", "Fasonda", "Sevke hazır", "Kısmen gidenler"]);
    expect(whereTabs(false).map((t) => t.label)).toEqual(["Tümü", "Bekleyenler", "Kısmen gidenler"]);
  });

  it("tanınmayan URL değeri 'Tümü' görünür", () => {
    expect(activeWhereTab("FASONDA")).toBe("FASONDA");
    expect(activeWhereTab("UYDURMA")).toBeNull();
    expect(activeWhereTab(null)).toBeNull();
  });

  it.each([["3", "3"], [" 07 ", "7"], ["0", "0"], ["3650", "3650"], ["3651", null], ["-1", null], ["2.5", null], ["", null], ["abc", null]])(
    "%j → %j",
    (inp, out) => expect(normalizeFasonGun(inp)).toBe(out),
  );
});
