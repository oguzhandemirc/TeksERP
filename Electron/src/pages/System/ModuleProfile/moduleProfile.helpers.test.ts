// =============================================================================
// BEKÇİ — SİSTEM PROFİLİ SAF KATMANI
// =============================================================================
// Üç iddia:
//   ① Fark → PATCH dönüşümü DB anahtarını camelCase alana çevirir ve tanınmayan
//      anahtarı SESSİZCE YUTMAZ (eksik uygulanmış profil, uygulanmamış
//      profilden kötüdür — kullanıcı bittiğini sanır).
//   ② "Kapatırsan gizlenir" listesi ekran manifestosunun `modul` alanından
//      gelir; mobil ekranlar sayılmaz (bu panel masaüstünü anlatıyor).
//   ③ Bağımlılık oku TERS yönde okunur: Ticaret'i kapatmak İplik'i götürür.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  describeDiffRow,
  diffToFlagPatch,
  moduleRequires,
  modulesThatDependOn,
  screensHiddenByModule,
  settingKeyOfModule,
} from "./moduleProfile.helpers";
import { MODULE_FLAG_KEYS } from "@/lib/module-flags";
import type { ScreenEntry } from "@/services/screenCatalogService";

describe("fark → PATCH gövdesi", () => {
  it("⭐ DB anahtarı camelCase alana çevrilir (nokta silmek YETMEZ)", () => {
    const { patch, unknownKeys } = diffToFlagPatch([
      { key: "production.enabled", from: true, to: false },
      // ⚠️ Bu satır tam olarak "noktayı sil" hilesinin çöktüğü yer:
      // `depo.multiEnabled` → `depomultiEnabled` olurdu.
      { key: "depo.multiEnabled", from: false, to: true },
    ]);
    expect(patch).toEqual({ productionEnabled: false, depoMultiEnabled: true });
    expect(unknownKeys).toEqual([]);
  });

  it("⭐ tanınmayan anahtar SESSİZCE ATLANMAZ", () => {
    const { patch, unknownKeys } = diffToFlagPatch([
      { key: "finance.enabled", from: false, to: true },
      { key: "sekizinci.modul", from: false, to: true },
    ]);
    expect(patch).toEqual({ financeEnabled: true });
    expect(unknownKeys).toEqual(["sekizinci.modul"]);
  });

  it("boş fark boş gövde üretir (uygulanacak bir şey yok)", () => {
    expect(diffToFlagPatch([])).toEqual({ patch: {}, unknownKeys: [] });
  });

  it("satır Türkçe adıyla ve İKİ YÖNÜYLE anlatılır (soyut sayı değil)", () => {
    expect(describeDiffRow({ key: "ticaret.enabled", from: false, to: true })).toBe(
      "Ticaret: Kapalı → Açık",
    );
    expect(describeDiffRow({ key: "iplik.enabled", from: true, to: false })).toBe(
      "İplik: Açık → Kapalı",
    );
  });
});

describe("kapatırsan gizlenecek ekranlar", () => {
  const screens: ScreenEntry[] = [
    { key: "operations/work-orders", app: "desktop", title: "İş Emirleri", requires: [], capabilities: [], modul: "productionEnabled" },
    { key: "definitions/routes", app: "desktop", title: "Üretim Rotaları", requires: [], capabilities: [], modul: "productionEnabled" },
    { key: "operations/rolls", app: "desktop", title: "Envanter", requires: [], capabilities: [], modul: "cekirdek:stok-giris" },
    { key: "kk1", app: "mobile", title: "KK1", requires: [], capabilities: [], modul: "productionEnabled" },
  ];

  it("⭐ masaüstü ve TABLET ekranları AYRI sayılır (tablet yutulmaz)", () => {
    // ⚠️ Bu testin eski hâli yalnız masaüstünü ölçüyordu ve tam da bu yüzden
    //    kör kalmıştı: ekran "gizlenen ekranlar (2)" yazıp KK1'i (tablet)
    //    hiç anmıyordu. Satıcı, üretimi kapatınca tabletin de duracağını
    //    göremiyordu (P5 doğrulamasının bulgusu).
    expect(screensHiddenByModule(screens, "productionEnabled")).toEqual({
      desktop: ["İş Emirleri", "Üretim Rotaları"],
      mobile: ["KK1"],
    });
  });

  it("çekirdek ekran hiçbir modülün listesine girmez", () => {
    expect(screensHiddenByModule(screens, "ticaretEnabled")).toEqual({
      desktop: [],
      mobile: [],
    });
  });

  it("`modul` alanı taşımayan (eski backend) girdiler sayılmaz", () => {
    const eski: ScreenEntry[] = [
      { key: "x", app: "desktop", title: "X", requires: [], capabilities: [] },
    ];
    expect(screensHiddenByModule(eski, "productionEnabled")).toEqual({
      desktop: [],
      mobile: [],
    });
  });
});

describe("bağımlılık oku", () => {
  it("⭐ TERS yön + GEÇİŞLİ: Ticaret kapanırsa İplik VE Devere kapanır", () => {
    expect(modulesThatDependOn("ticaretEnabled")).toEqual(["iplikEnabled", "devereEnabled"]);
    // 2026-09-13: dokuma işi de üretime bağlı (tezgahın kardeşi) — BFS sırası tablo sırası.
    expect(modulesThatDependOn("productionEnabled")).toEqual(["tezgahEnabled", "dokumaEnabled"]);
    expect(modulesThatDependOn("iplikEnabled")).toEqual(["devereEnabled"]);
  });

  it("bağımlısı olmayan modülde liste boş", () => {
    expect(modulesThatDependOn("financeEnabled")).toEqual([]);
    expect(modulesThatDependOn("devereEnabled")).toEqual([]);
    expect(modulesThatDependOn("dokumaEnabled")).toEqual([]);
    // Kardeşlik: tezgah dokumaya bağlı DEĞİL.
    expect(modulesThatDependOn("tezgahEnabled")).toEqual([]);
  });

  it("düz yön: İplik açılmadan önce Ticaret açık olmalı", () => {
    expect(moduleRequires("iplikEnabled")).toBe("ticaretEnabled");
    expect(moduleRequires("tezgahEnabled")).toBe("productionEnabled");
    expect(moduleRequires("dokumaEnabled")).toBe("productionEnabled");
    expect(moduleRequires("ticaretEnabled")).toBeUndefined();
  });
});

describe("audit anahtarı (ters harita)", () => {
  it("⭐ camelCase alan → DB anahtarı; string oyunu YAPILMAZ", () => {
    expect(settingKeyOfModule("productionEnabled")).toBe("production.enabled");
    // `replace("Enabled", ".enabled")` burada `depoMulti.enabled` üretirdi ve
    // geçmiş listesi sessizce BOŞ dönerdi ("hiç değiştirilmemiş" yalanı).
    expect(settingKeyOfModule("depoMultiEnabled")).toBe("depo.multiEnabled");
    expect(settingKeyOfModule("kumasTeknikEnabled")).toBe("kumasTeknik.enabled");
  });

  it("yedi alanın hepsi çözülüyor (kör nokta yok)", () => {
    for (const k of MODULE_FLAG_KEYS) expect(settingKeyOfModule(k), k).toBeTruthy();
  });
});
