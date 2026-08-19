import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { systemTiles } from "./tile-config";

/**
 * KARO ↔ ROUTE İZİN HİZASI.
 *
 * Sapmanın görünümü şudur: kullanıcı Sistem hub'ında (ya da Ctrl+K'da) kartı
 * GÖRÜR, tıklar ve `/forbidden`'a düşer. Ne hata mesajı sebebi söyler ne de
 * bir log. `CLAUDE.md` bu sınıfı belge-şablonu izinleri için tek tek yazmış;
 * bu test aynı kuralı TÜM sistem karoları için mekanikleştirir.
 *
 * Kural: karo `permission` taşıyorsa route AYNI kodu istemeli. Taşımıyorsa
 * hub'ın varsayılan kapısı (`admin:settings`) geçerlidir ve route da onu
 * istemeli — palet de aynı varsayılana düşüyor (`command-entries.ts`).
 *
 * ⚠️ Route dosyası KAYNAK METİN olarak okunur, import EDİLMEZ: içinde
 * uygulamanın tüm sayfa ağacı var (`command-entries.test.ts` ile aynı gerekçe).
 */

const ROUTES_SRC = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");
const HUB_DEFAULT = "admin:settings";

/** `path: "system/x"` → o route bloğundaki `requirePermission="..."`. */
function routePermission(pathname: string): string | null | "ANY" {
  const rel = pathname.replace(/^\//, "");
  const idx = ROUTES_SRC.indexOf(`path: "${rel}"`);
  if (idx < 0) return null;
  // Blok sınırı: bir sonraki `path:` (ya da dosya sonu) — izin ondan önce olmalı.
  const nextIdx = ROUTES_SRC.indexOf("path: \"", idx + 10);
  const block = ROUTES_SRC.slice(idx, nextIdx < 0 ? undefined : nextIdx);
  const single = /requirePermission="([^"]+)"/.exec(block);
  if (single?.[1]) return single[1];
  if (/requireAnyPermission=/.test(block)) return "ANY";
  return null;
}

describe("sistem karoları ↔ route izinleri", () => {
  // KÖRLÜK ZEMİNİ: dosya taşınsa ya da `path:` yazımı değişse "sapma yok" ile
  // "hiçbir şeye bakmadım" AYNI YEŞİLE çıkardı.
  it("zemin: karolar ve route metni okunabildi", () => {
    expect(systemTiles.length).toBeGreaterThan(5);
    expect(ROUTES_SRC.length).toBeGreaterThan(5000);
    expect(routePermission("/system/data-import")).toBe("data:import");
  });

  it.each(systemTiles.map((t) => [t.key, t] as const))(
    "%s karosunun route'u var",
    (_key, tile) => {
      expect(routePermission(tile.to), `${tile.to} content-routes.tsx'te YOK`).not.toBeNull();
    },
  );

  it.each(systemTiles.map((t) => [t.key, t] as const))(
    "%s karosu route ile AYNI izni istiyor",
    (_key, tile) => {
      const routePerm = routePermission(tile.to);
      if (routePerm === "ANY") return; // çok izinli route — ayrı kuralla korunuyor
      expect(routePerm).toBe(tile.permission ?? HUB_DEFAULT);
    },
  );

  // Bu ekranın hedef kullanıcısı SATIŞ'tır ve onda `admin:settings` YOKTUR.
  // Kendi iznini taşımazsa hub'ın kapısına düşer ve tam da onu kullanacak kişi
  // ekranı hiç göremez (2026-08-01 kurşun bypass vakasının aynısı).
  it("Mükerrer Kayıtlar kendi iznini taşır (admin:settings'e düşmez)", () => {
    const tile = systemTiles.find((t) => t.key === "duplicates");
    expect(tile?.permission).toBe("master-data:merge");
    expect(routePermission("/system/duplicates")).toBe("master-data:merge");
  });
});
