import { describe, it, expect } from "vitest";
import { screenAccess, screensUsing, filterScreens, screenCodes } from "./screen-view";
import { foldSearchText } from "@/lib/search-fold";
import type { ScreenEntry } from "@/services/screenCatalogService";

// =============================================================================
// "Ekrana göre" yetki görünümü — saf kurallar (2026-08-19)
// =============================================================================
// Yetki mimarisi Katman 2, adım 2. Karar belgesi: docs/design/YETKI-MIMARISI.md
// =============================================================================

const kk1: ScreenEntry = {
  key: "KK1",
  app: "mobile",
  title: "Ham Giriş",
  requires: ["mobile:kk1"],
  capabilities: [
    { code: "mobile:kk1-desen", label: "Yeni desen oluşturabilir" },
    { code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" },
  ],
};
const hizli: ScreenEntry = {
  key: "HizliIsEmri",
  app: "mobile",
  title: "Hızlı İş Emri",
  requires: ["mobile:hizli-is-emri"],
  capabilities: [{ code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }],
};
const belge: ScreenEntry = {
  key: "definitions/document-templates",
  app: "desktop",
  title: "Belge Şablonları",
  // Üç izinden HERHANGİ BİRİ ekranı açar.
  requires: ["admin:settings", "document-template:read", "document-template:write"],
  capabilities: [{ code: "document-template:write", label: "Tasarımı değiştirebilir" }],
};
const all = [kk1, hizli, belge];

describe("ekran erişim durumu", () => {
  it("giriş izni seçiliyse AÇIK", () => {
    expect(screenAccess(kk1, new Set(["mobile:kk1"]))).toBe("open");
  });

  it("hiçbiri seçili değilse KAPALI", () => {
    expect(screenAccess(kk1, new Set())).toBe("closed");
  });

  it("giriş izni YOK ama yetenek seçiliyse UYARIR", () => {
    // Sessiz bırakmak yöneticiye yetki verdiğini sandırır — yetenek etkisizdir.
    expect(screenAccess(kk1, new Set(["mobile:kk1-desen"]))).toBe("capability-only");
  });

  it("çok girişli ekranda HERHANGİ BİRİ yeterlidir", () => {
    // "hepsi" arayan bir kural belge ekranını yanlışlıkla kapalı gösterirdi:
    // orada üç iznin biri (örn. yalnız admin:settings) ekranı zaten açıyor.
    expect(screenAccess(belge, new Set(["admin:settings"]))).toBe("open");
    expect(screenAccess(belge, new Set(["document-template:read"]))).toBe("open");
  });
});

describe("ortak yetki tespiti", () => {
  it("aynı yetkiyi kullanan TÜM ekranları bulur", () => {
    // Yetkiyi ekran başına çoğaltmamanın bedeli: `mobile:kumas` iki ekranda.
    // Arayüz bunu söylemezse "KK1'den kaldırdım, Hızlı İş Emri bozuldu" olur.
    expect(screensUsing(all, "mobile:kumas").map((s) => s.key)).toEqual(["KK1", "HizliIsEmri"]);
  });

  it("giriş izni olarak geçen yetkiyi de sayar", () => {
    expect(screensUsing(all, "mobile:kk1")).toHaveLength(1);
  });

  it("hem giriş hem yetenek olan yetki TEK kez sayılır", () => {
    // belge ekranında document-template:write hem requires hem capabilities'te.
    expect(screensUsing(all, "document-template:write")).toHaveLength(1);
  });
});

describe("ekran arama", () => {
  it("Türkçe-duyarsız başlık araması", () => {
    expect(filterScreens(all, "hizli", foldSearchText).map((s) => s.key)).toEqual(["HizliIsEmri"]);
    expect(filterScreens(all, "HIZLI", foldSearchText).map((s) => s.key)).toEqual(["HizliIsEmri"]);
  });

  it("YETKİ KODUYLA arama — 'bu yetki nerede kullanılıyor' sorusu", () => {
    // Manifestonun en çok işe yarayacağı sorgu bu.
    expect(filterScreens(all, "mobile:kumas", foldSearchText).map((s) => s.key)).toEqual([
      "KK1",
      "HizliIsEmri",
    ]);
  });

  it("yetenek ETİKETİYLE de bulunur", () => {
    expect(filterScreens(all, "desen", foldSearchText).map((s) => s.key)).toEqual(["KK1"]);
  });

  it("boş terim hepsini döner", () => {
    expect(filterScreens(all, "   ", foldSearchText)).toHaveLength(3);
  });
});

describe("ekranın tüm kodları", () => {
  it("giriş + yetenek birleşir", () => {
    expect(screenCodes(kk1)).toEqual(["mobile:kk1", "mobile:kk1-desen", "mobile:kumas"]);
  });

  it("tekrar eden kod TEK kez — 'hepsini ver' iki kez eklemesin", () => {
    expect(screenCodes(belge)).toEqual([
      "admin:settings",
      "document-template:read",
      "document-template:write",
    ]);
  });
});
