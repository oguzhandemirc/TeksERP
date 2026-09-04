import { describe, it, expect } from "vitest";
import {
  activeWindowLabel,
  agoLabel,
  clientTitle,
  isOutdated,
  kindLabel,
} from "./clients-utils";

/**
 * Bağlı İstemciler ekranının SÖZLERİ. Her kontrol, ekranın ölçtüğünden fazlasını
 * iddia etmesini engelliyor.
 */
describe("kindLabel — uydurmama", () => {
  it("bilinen türler Türkçe okunur", () => {
    expect(kindLabel("electron")).toBe("Masaüstü panel");
    expect(kindLabel("mobil")).toBe("Tablet");
    expect(kindLabel("web")).toBe("Tarayıcı");
  });

  it("künye bildirilmemişse 'Bilinmiyor' — panel diye VARSAYILMAZ", () => {
    expect(kindLabel(null)).toBe("Bilinmiyor");
  });

  it("tanınmayan tür olduğu gibi basılır (sessizce bir kovaya atılmaz)", () => {
    expect(kindLabel("korsan")).toBe("korsan");
  });
});

describe("activeWindowLabel — eşik metni SUNUCUDAN", () => {
  it("sunucudan gelen ms'i dakikaya çevirir", () => {
    expect(activeWindowLabel(5 * 60_000)).toBe("5 dakika");
    expect(activeWindowLabel(60_000)).toBe("1 dakika");
  });

  it("eşik değişirse metin de değişir (ekran kendi sayısını yazmıyor)", () => {
    expect(activeWindowLabel(10 * 60_000)).toBe("10 dakika");
  });
});

describe("isOutdated — 'güncel değil' işareti", () => {
  it("sürüm GERİDEYSE işaretlenir", () => {
    expect(isOutdated("1.2.5", "1.2.6")).toBe(true);
    expect(isOutdated("1.9.0", "1.10.0")).toBe(true); // sözlüksel tuzağı
  });

  it("eşitse işaretlenmez", () => {
    expect(isOutdated("1.2.6", "1.2.6")).toBe(false);
  });

  it("İLERİDEYSE işaretlenmez — test makinesi kırmızı alarm üretmemeli", () => {
    expect(isOutdated("1.3.0", "1.2.6")).toBe(false);
  });

  it("bilinmeyen taraf varsa işaretlenmez (fail-open)", () => {
    expect(isOutdated(null, "1.2.6")).toBe(false);
    expect(isOutdated("1.2.6", null)).toBe(false);
    expect(isOutdated(null, null)).toBe(false);
  });
});

describe("clientTitle — ad İSTEMCİDEN gelmez", () => {
  it("yöneticinin verdiği cihaz adı kullanılır", () => {
    expect(clientTitle("Tambur-1 Tablet", "abcdef12-0000")).toBe("Tambur-1 Tablet");
  });

  it("Device satırı yoksa kısa kimlik basılır — uydurma ad YOK", () => {
    expect(clientTitle(null, "abcdef1234567890")).toBe("Tanımsız (abcdef12)");
  });
});

describe("agoLabel — SUNUCU saatine göre", () => {
  const now = "2026-09-04T12:00:00.000Z";

  it("bir dakikadan yeni → 'az önce'", () => {
    expect(agoLabel("2026-09-04T11:59:30.000Z", now)).toBe("az önce");
  });

  it("dakika / saat / gün kademeleri", () => {
    expect(agoLabel("2026-09-04T11:57:00.000Z", now)).toBe("3 dk önce");
    expect(agoLabel("2026-09-04T09:55:00.000Z", now)).toBe("2 sa 5 dk önce");
    expect(agoLabel("2026-09-04T09:00:00.000Z", now)).toBe("3 sa önce");
    expect(agoLabel("2026-09-02T12:00:00.000Z", now)).toBe("2 gün önce");
  });

  it("okunamayan damga sessizce '—' (ekran çökmez)", () => {
    expect(agoLabel("çöp", now)).toBe("—");
  });
});
