import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEARCH_TARGETS, SERVER_ITEM_PREFIX, serverItemValue } from "./search-targets";

/**
 * GLOBAL ARAMA HEDEF BEKÇİSİ (Faz A3).
 *
 * Palet artık bir KAYDA tıklandığında uygulamayı başka bir sayfaya götürüyor.
 * Hedef adres bu dosyada ELLE yazılı; route'lar başka bir dosyada yaşıyor. İkisi
 * ayrışırsa arıza şu şekilde görünür: kullanıcı sonucu bulur, tıklar ve **boş
 * ekrana** düşer — ne hata ne log. Bu test o ayrışmayı mekanik yakalar.
 *
 * `content-routes.tsx` KAYNAK METNİ okunur, import EDİLMEZ (`command-entries.test.ts`
 * ile aynı gerekçe: o dosya uygulamanın tüm sayfa ağacını çeker; bir bekçinin
 * onu ayağa kaldırması gerekmez).
 */

const ROUTES_SRC = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");

/** `path: "operations/rolls"` → `/operations/rolls`. Joker (`*`) atlanır, `:id` KORUNUR. */
function routePatterns(): string[] {
  return [...ROUTES_SRC.matchAll(/path:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p): p is string => Boolean(p) && p !== "*")
    .map((p) => (p.startsWith("/") ? p : `/${p}`));
}

const PATTERNS = routePatterns();

/** `/operations/work-orders/<uuid>` ⟷ `/operations/work-orders/:id` */
function matchesSomeRoute(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return PATTERNS.some((pattern) => {
    const pp = pattern.split("/").filter(Boolean);
    if (pp.length !== parts.length) return false;
    return pp.every((seg, i) => seg.startsWith(":") || seg === parts[i]);
  });
}

const ROW = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "ŞAHİN TEKSTİL",
  subtitle: null,
  code: "MUS-000123",
};

const ENTRIES = Object.entries(SEARCH_TARGETS);

describe("search-targets — hedef adresleri", () => {
  // KÖRLÜK ZEMİNİ: ayrıştırıcı bozulursa (dosya taşınır, `path:` yazımı değişir)
  // "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkar.
  it("zemin: route ayrıştırması ve katalog dolu", () => {
    expect(PATTERNS.length).toBeGreaterThan(40);
    expect(ENTRIES.length).toBeGreaterThanOrEqual(9);
  });

  it.each(ENTRIES)("%s → to() tanımlı bir route'a gidiyor", (_key, target) => {
    const dest = target.to(ROW);
    const pathname = dest.to.split("?")[0] ?? "";
    expect(matchesSomeRoute(pathname), `${pathname} content-routes.tsx'te YOK`).toBe(true);
  });

  it.each(ENTRIES)("%s → listTo() tanımlı bir route'a gidiyor", (_key, target) => {
    const pathname = target.listTo("şahin").split("?")[0] ?? "";
    expect(matchesSomeRoute(pathname), `${pathname} content-routes.tsx'te YOK`).toBe(true);
  });

  it.each(ENTRIES)("%s → izin ve etiket dolu", (_key, target) => {
    expect(target.permissions.length).toBeGreaterThan(0);
    expect(target.label.trim().length).toBeGreaterThan(0);
  });

  // Terim URL'e GÖMÜLÜYOR — kaçırılmazsa `&`/`#` içeren ad adresi böler.
  it("listTo() arama terimini kaçırıyor", () => {
    for (const [key, target] of ENTRIES) {
      const url = target.listTo("a&b c#d");
      expect(url.includes("&b"), `${key}: '&' kaçırılmamış`).toBe(false);
      expect(url.includes("#d"), `${key}: '#' kaçırılmamış`).toBe(false);
    }
  });

  // cmdk `value`'su SORGUDAN BAĞIMSIZ olmalı — sorguyu gömmek her tuşta yeni bir
  // value üretir ve cmdk'nın seçim durumu sıfırlanır (ok tuşu çalışmaz).
  it("serverItemValue kararlı ve önekli", () => {
    const v = serverItemValue("customer", ROW.id);
    expect(v.startsWith(SERVER_ITEM_PREFIX)).toBe(true);
    expect(v).toBe(serverItemValue("customer", ROW.id));
    expect(v).not.toBe(serverItemValue("item", ROW.id));
  });
});
