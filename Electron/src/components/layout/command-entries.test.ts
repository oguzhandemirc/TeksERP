import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allCommandEntries, commandSections, findBreadcrumbParent } from "./command-entries";
import { navGroups } from "./nav-config";
import { reportTiles } from "@/pages/Reports/tile-config";

/**
 * KOMUT PALETİ BEKÇİSİ.
 *
 * Saha şikâyeti (2026-08-06): "Ctrl+K açılıyor ama bir çok menü aramada
 * çıkmıyor." Sebep katalogun ELLE tutulmasıydı — Raporlar'ın 7 hub'ı ve 20 alt
 * raporu hiç eklenmemişti ve bunu söyleyen hiçbir şey yoktu. Bu test, route
 * eklenip palete eklenmeyen ekranı MEKANİK olarak yakalar.
 *
 * `content-routes.tsx` KAYNAK METNİ okunur, import EDİLMEZ: dosya uygulamanın
 * tüm sayfalarını çeker (apiClient, native köprüler…) ve bir bekçi testinin o
 * ağacı ayağa kaldırması gerekmez.
 */

const ROUTES_SRC = readFileSync(
  resolve(__dirname, "../../routes/content-routes.tsx"),
  "utf8",
);

/** `path: "operations/rolls"` → `/operations/rolls`. Dinamik/joker yollar atlanır. */
function staticRoutePaths(): string[] {
  const found = [...ROUTES_SRC.matchAll(/path:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p): p is string => Boolean(p));
  return found
    .filter((p) => !p.includes(":") && p !== "*")
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
}

/**
 * Katalogda BULUNMASI beklenmeyen route'lar ve sebepleri. Listeye ekleme yapmak
 * bilinçli bir karardır — "unuttum" ile "istemiyorum" ayrımı burada yazılı olsun.
 */
const EXEMPT: Record<string, string> = {
  "/forbidden": "hata sayfası — kullanıcı oraya gitmez, oraya düşer",
  "/operations/kursun-queue": "eski adres → /operations/kursun-dagitim'e yönlendirir",
  "/operations/sack-search": "eski adres → /operations/sack-content-edit'e yönlendirir",
  "/operations/scan-dispatch": "eski adres → /operations/sack-store'a yönlendirir",
  "/definitions/label-templates": "Etiketler ekranının 'Düzenler' sekmesi olarak listelenir",
  "/access/devices/:id": "detay yolu",
};

describe("komut paleti kataloğu", () => {
  const paths = new Set(allCommandEntries.map((e) => e.to.split("?")[0]));

  it("her statik route'un bir palet girişi var", () => {
    const missing = staticRoutePaths().filter((p) => !paths.has(p) && !(p in EXEMPT));
    expect(missing, `palette eksik ekran(lar): ${missing.join(", ")}`).toEqual([]);
  });

  it("Raporlar'ın yedi kategorisi ve alt raporları katalogda", () => {
    // Regresyon çıpası: şikâyetin ta kendisi. Kategori hub'ı + en az bir alt rapor.
    for (const cat of ["production", "sales", "quality", "inventory", "subcontract", "customer", "audit"]) {
      expect(paths.has(`/reports/${cat}`), `/reports/${cat} yok`).toBe(true);
      const subs = allCommandEntries.filter((e) => e.to.startsWith(`/reports/${cat}/`));
      expect(subs.length, `/reports/${cat} altında alt rapor yok`).toBeGreaterThan(0);
    }
  });

  it("rapor girişleri kategorinin iznini taşır (görünür ama /forbidden olmasın)", () => {
    for (const entry of allCommandEntries.filter((e) => e.to.startsWith("/reports/"))) {
      const domain = entry.to.split("/")[2];
      expect(entry.permission, `${entry.to} izinsiz`).toBe(`report:${domain}`);
    }
  });

  it("aynı hedefi ilk gösteren giriş sayfanın KENDİ girişidir (alt başlıklar sonda)", () => {
    // `findCommandEntry` ilk eşleşmeyi döner; hub bölüm başlıkları da hub'a
    // çıktığı için sıra bozulursa sekme başlığı sayfa adının yerine geçer.
    const firstDeepIndex = allCommandEntries.findIndex((e) => e.deep);
    const lastPlainIndex = allCommandEntries.map((e) => Boolean(e.deep)).lastIndexOf(false);
    expect(firstDeepIndex).toBeGreaterThan(lastPlainIndex);
  });

  it("giriş anahtarları benzersiz", () => {
    const keys = allCommandEntries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("alt rapor breadcrumb'ı kategori hub'ına, hub ise Raporlar'a çıkar", () => {
    // 2026-08-09: "/reports/production/scrap" KALDIRILDI (Fire Karnesi Kalite
    // altında). Örnek, hâlâ var olan bir alt raporla değiştirildi — silinmiş bir
    // rotayla test etmek, breadcrumb kuralını değil yokluğu doğrulardı.
    expect(findBreadcrumbParent("/reports/production/wip")).toEqual({
      label: "Üretim",
      to: "/reports/production",
    });
    expect(findBreadcrumbParent("/reports/production")).toEqual({
      label: "Raporlar",
      to: "/reports",
    });
  });

  it("bölüm başlıkları benzersiz (cmdk grupları çakışmasın)", () => {
    const headings = commandSections.map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  // ===========================================================================
  // ⭐ ÜÇÜNCÜ GİRİŞ KAPISI — MENÜDE GİZLENEN SATIR PALETTE KALMAZ (2026-09-03)
  // ===========================================================================
  // 2026-09-03 öncesi `navGroups` girdileri palete kopyalanırken YALNIZ izin ve
  // `adminOnly` taşınıyordu; `featureFlag` DÜŞÜYORDU. Tek örnek "Muhasebe"ydi ve
  // zararsız görünüyordu — çünkü bayrak kapalı bir kurulumda `finance:read` izni
  // de atanmaz. Zararsızlık bir TESADÜFE dayanıyordu. Union beş modüle
  // genişlerken tesadüf biter: bir gün izni herkeste olan bir modül satırı
  // eklenir ve palet, menüde olmayan ekrana derin bağlantı verir.
  it("⭐ nav satırının modül bayrağı palet girişine TAŞINIR", () => {
    const navEntries = commandSections
      .filter((s) => navGroups.some((g) => g.label === s.heading))
      .flatMap((s) => s.entries);
    // Körlük zemini: bugün bayrak taşıyan en az bir nav satırı var.
    const flagged = navGroups.flatMap((g) => g.items).filter((i) => i.featureFlag);
    expect(flagged.length).toBeGreaterThanOrEqual(1);

    for (const item of navGroups.flatMap((g) => g.items)) {
      const entry = navEntries.find((e) => e.key === `nav:${item.to}`);
      expect(entry, `${item.to} palet girişi yok`).toBeDefined();
      if (!item.featureFlag) {
        expect(entry?.visibleWhen, item.to).toBeUndefined();
        continue;
      }
      expect(entry?.visibleWhen, `${item.to} bayrağı taşımıyor`).toBeDefined();
      // Yüklem GERÇEKTEN o alanı okuyor mu — kimlik değil DAVRANIŞ ölçülüyor
      // (alan adı bir string; yanlış alanı okuyan bir yüklem de "tanımlı"dır).
      const ctxTrue = { [item.featureFlag]: true } as never;
      const ctxFalse = { [item.featureFlag]: false } as never;
      expect(entry?.visibleWhen?.(ctxTrue), item.to).toBe(true);
      expect(entry?.visibleWhen?.(ctxFalse), item.to).toBe(false);
    }
  });

  it("⭐ rapor kategorisinin modül bayrağı da palet girişine taşınır (hub + ALT raporlar)", () => {
    const flagged = reportTiles.filter((t) => t.featureFlag);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    for (const cat of flagged) {
      const section = commandSections.find((s) => s.heading === `Raporlar · ${cat.title}`);
      expect(section, cat.key).toBeDefined();
      // Alt rapor route'ları da kategori kapısındadır → hepsi yüklem taşımalı.
      for (const e of section!.entries) {
        const ctxFalse = { [cat.featureFlag!]: false } as never;
        expect(e.visibleWhen?.(ctxFalse), `${cat.key}/${e.key}`).toBe(false);
      }
    }
  });
});
