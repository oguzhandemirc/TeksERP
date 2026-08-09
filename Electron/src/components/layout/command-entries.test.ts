import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allCommandEntries, commandSections, findBreadcrumbParent } from "./command-entries";

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
});
