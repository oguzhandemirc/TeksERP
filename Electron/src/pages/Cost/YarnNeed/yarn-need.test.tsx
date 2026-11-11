import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ReportTable } from "@/pages/Reports/_v2/ReportTable";
import type { RaporSunumu, TabloBlok } from "@/pages/Reports/_v2/sunum";
import { costTiles } from "../tile-config";
import { excludedText, missingText, rawBasisText, reservationText, sourceBadges, wasteSourceText } from "./yarn-need-model";

// Sunucu zarfının küçük kopyası: iplik modülü kapalı → stok hücresi sunucudan "bilinmiyor" gelir.
const tablo: TabloBlok = {
  kolonlar: [
    { anahtar: "iplik", baslik: "İplik" },
    { anahtar: "ihtiyacKg", baslik: "İhtiyaç", birim: "kg", hiza: "sag" },
    { anahtar: "serbestStokKg", baslik: "Serbest stok", birim: "kg", hiza: "sag" },
    { anahtar: "eksikKg", baslik: "Eksik", birim: "kg", hiza: "sag" },
  ],
  satirlar: [{ iplik: "Ne 30/1 Pamuk", ihtiyacKg: "120.500", serbestStokKg: "bilinmiyor", eksikKg: "120.500" }],
} as TabloBlok;

const sunum = {
  anahtar: "maliyet/iplik-ihtiyaci", baslik: "İplik İhtiyaç Planı", soru: "?", donem: { etiket: "Bugün" },
  anaSayi: { ad: "Eksik", deger: 120.5, birim: "kg" }, yanSayilar: [], anlati: [], uyarilar: [], tanimlar: [], parametreler: [], tablo,
} as unknown as RaporSunumu;

describe("İplik İhtiyaç Planı (MAL-7)", () => {
  it("bilinmeyen hücre ekranda 0 değil 'bilinmiyor' yazar", () => {
    render(<ReportTable table={tablo} />);
    expect(screen.getByText("bilinmiyor")).toBeTruthy();
  });

  it("Excel tablosu ekranın kolonlarını aynı sırayla taşır; bilinmeyen hücre aynı metin", () => {
    const spec = buildExportSpec(sunum);
    const t = spec.tables.at(-1)!;
    expect(t.columns.map((c) => c.key)).toEqual(tablo.kolonlar.map((c) => c.anahtar));
    expect(t.rows[0]!.serbestStokKg).toBe("bilinmiyor");
  });

  it("kapalı kaynak rozeti 'bilinmiyor' der; dışlanan ürün yoksa şerit yok", () => {
    const b = sourceBadges({ stok: false, emanet: false, acikAlis: true, leventDusumu: true });
    expect(b.find((x) => x.key === "stok")!.label).toContain("bilinmiyor");
    expect(b.find((x) => x.key === "acikAlis")!.on).toBe(true);
    expect(excludedText({ yapisiEksik: [], olculemeyen: [] })).toBeNull();
    expect(excludedText({ yapisiEksik: [{ urunId: "u", urunKodu: "K", urun: "A", kalemSayisi: 1, metre: "10", eksikler: ["atkı"] }], olculemeyen: [] }))
      .toBe("İhtiyaca girmeyen ürünler (1) — listeyi gör");
    expect(missingText("WARP_SPEC_MISSING")).toMatch(/^Çözgü kartı bağlı değil/);
    expect(missingText("BILINMEYEN")).toBe("BILINMEYEN");
  });

  it("hub karosu sayfaya ve backend izniyle birebir", () => {
    const t = costTiles.find((x) => x.key === "yarn-need")!;
    expect(t.to).toBe("/cost/yarn-need");
    expect(t.permissionAny).toEqual(["report:yarn-need"]);
  });
});

describe("İplik İhtiyaç Planı — ham metre esası (K5)", () => {
  it("HAM + sipariş metresi → ikisi ayrı yazılır, fire dahil", () => {
    expect(rawBasisText({ metreEsasi: "HAM", dokumaFiresiPct: 2 }, { kumasMetre: "1133.8", siparisMetre: "1000.0" }))
      .toBe("Kg'lar ham metreye göre: sipariş 1.000 m → dokunacak ham 1.134 m (çekme ve %2 dokuma firesi dahil).");
  });
  it("HAM, fire 0, sipariş metresi yok → yalnız esas cümlesi", () => {
    expect(rawBasisText({ metreEsasi: "HAM", dokumaFiresiPct: 0 })).toBe("Kg'lar ham metreye göre hesaplanır (çekme dahil).");
  });
  it("eski backend (metreEsasi yok) → satır yok", () => {
    expect(rawBasisText({}, { kumasMetre: "10", siparisMetre: "9" })).toBeNull();
  });
});

describe("İplik İhtiyaç Planı — iplik firesi kaynağı (SY-3 I2)", () => {
  it("IPLIK satırları kodla sayılır; KART ya da alan yoksa (eski backend) satır yok", () => {
    expect(wasteSourceText([{ iplikKodu: "IP1", iplik: "A", fireKaynagi: "IPLIK" }, { iplikKodu: "IP2", iplik: "B", fireKaynagi: "KART" }]))
      .toBe("İplik kartındaki fire kullanıldı: IP1. Ötekilerde çözgü/atkı kartının firesi geçerli.");
    expect(wasteSourceText([{ iplikKodu: "IP2", iplik: "B", fireKaynagi: "KART" }, { iplikKodu: "IP3", iplik: "C" }])).toBeNull();
    expect(wasteSourceText(undefined)).toBeNull();
  });
  it("beşten fazlası 've N iplik daha' ile kısalır; kodsuz iplik adıyla", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ iplikKodu: i === 0 ? "" : `K${i}`, iplik: `Ad${i}`, fireKaynagi: "IPLIK" as const }));
    expect(wasteSourceText(rows)).toBe("İplik kartındaki fire kullanıldı: Ad0, K1, K2, K3, K4 ve 2 iplik daha. Ötekilerde çözgü/atkı kartının firesi geçerli.");
  });
});

describe("İplik İhtiyaç Planı — iplik ayırma (SY-3 I1)", () => {
  const ay = (over = {}) => ({ isSayisi: 3, yapisiEksikIsler: [], talepNetlendi: true, netlenenKumasM: "1250.5", ...over });
  it("ayar kapalı (ayirma yok) → satır yok", () => {
    expect(reservationText({})).toBeNull();
  });
  it("açık: iş sayısı ve talepten düşülen ham metre", () => {
    expect(reservationText({ ayirma: ay() })).toBe("İplik ayırma açık: 3 açık dokuma işinin kalan metresi için iplik ayrıldı; bu işlerin 1.251 m kalanı ihtiyaçtan düşüldü.");
  });
  it("müşteri süzgecinde (talep netlenmedi) düşüm cümlesi yok; iş yoksa ayrı cümle", () => {
    expect(reservationText({ ayirma: ay({ talepNetlendi: false }) })).toBe("İplik ayırma açık: 3 açık dokuma işinin kalan metresi için iplik ayrıldı.");
    expect(reservationText({ ayirma: ay({ isSayisi: 0, netlenenKumasM: "0" }) })).toBe("İplik ayırma açık: açık dokuma işi yok, ayrılan iplik yok.");
  });
});
