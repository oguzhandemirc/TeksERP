import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOSS_PATH } from "@/lib/boss-path";
import { readHashPath } from "@/lib/use-hash-path";

/**
 * PATRON KABUĞU — kapı ile rota HİZALI mı.
 *
 * ⭐ ASIL İDDİA: `App.tsx`in "hangi kabuğu çizeyim" kararı ile `content-routes`
 * kaydı AYNI yoldan beslenir. Ayrışırlarsa arıza SESSİZDİR: kabuk açılır ama
 * içi boş kalır (router hiçbir rotaya uymaz) — hata da log da yok. Bu, depoda
 * "kart görünür, tıklayınca /forbidden" diye zaten bir kez yaşanmış sınıfın
 * aynısı.
 *
 * ⭐ İKİNCİ İDDİA: hash REAKTİF okunuyor. Düz `window.location.hash` React'e
 * hiçbir şey söylemez; kabuk geçişleri tepkisiz kalır ve "düğme çalışmıyor"
 * şikâyeti üretir (ilk yazımda tam bu oldu).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("hash yolu çözümleyicisi", () => {
  it("hash'i yola çevirir", () => {
    expect(readHashPath("#/boss")).toBe("/boss");
    expect(readHashPath("#/boss?x=1")).toBe("/boss");
    expect(readHashPath("#/operations/rolls")).toBe("/operations/rolls");
  });

  it("hash yokken köke düşer", () => {
    expect(readHashPath("")).toBe("/");
    expect(readHashPath("#")).toBe("/");
    expect(readHashPath("#/")).toBe("/");
  });

  it("eğik çizgisiz hash de yol olur", () => {
    expect(readHashPath("#boss")).toBe("/boss");
  });

  it("⚠️ ön ek eşleşmesi YOL SINIRINDA olmalı", () => {
    // `startsWith("#/boss")` yazılsaydı ileride eklenecek bir `/bosslar`
    // rotası da patron kabuğunu açardı — sessiz ve teşhisi zor.
    expect(readHashPath("#/bosslar")).toBe("/bosslar");
    expect(readHashPath("#/bosslar")).not.toBe(BOSS_PATH);
  });
});

describe("kapı ↔ rota hizası", () => {
  const app = stripComments(read("src/App.tsx"));
  const routes = stripComments(read("src/routes/content-routes.tsx"));
  const shell = stripComments(read("src/components/layout/BossShell.tsx"));

  it("üç tüketici de TEK KAYNAKTAN (BOSS_PATH) okuyor", () => {
    for (const [name, src] of [
      ["App.tsx", app],
      ["content-routes.tsx", routes],
      ["BossShell.tsx", shell],
    ] as const) {
      expect(src, `${name} BOSS_PATH kullanmalı`).toContain("BOSS_PATH");
    }
  });

  it("⚠️ yol hiçbir yerde ELLE yazılmamış", () => {
    for (const src of [app, routes, shell]) {
      expect(src).not.toMatch(/["'`]\/boss["'`]/);
      expect(src).not.toMatch(/["'`]#\/boss/);
    }
  });

  it("App.tsx hash'i REAKTİF okuyor (useHashPath)", () => {
    expect(app).toContain("useHashPath");
    // Düz okuma kalmışsa kabuk geçişi tepkisiz kalır.
    expect(app).not.toMatch(/window\.location\.hash\.startsWith/);
  });

  it("BossShell sekme altyapısını KULLANIYOR (kendi router'ını kurmuyor)", () => {
    // `content-routes` sayfaları useTabId / TabPortalProvider / geçmiş defterine
    // bağlı; kendi memory router'ını kurmak `PageHeader`ın geri okunu sessizce
    // öldürür ve modalleri yanlış yere portallar.
    //
    // ⚠️ 2026-09-04 — İDDİA AYNI, ÖLÇÜM YERİ DEĞİŞTİ VE GENİŞLEDİ. Özet
    // görünümü kapılı bir kök layout kullanmaya başlayınca router fabrikası
    // `getTabRouter` → `getBossTabRouter` oldu. Eski yazım TEK bir sembol adına
    // bakıyordu ve bunun bir KÖR NOKTASI vardı: adı denetlemek, o fabrikanın
    // paylaşılan `build()`ten geçtiğini KANITLAMAZ — biri `tab-routers.tsx`
    // içinde `createMemoryRouter`ı doğrudan çağıran ikinci bir fabrika yazsaydı
    // bekçi yeşil kalır, geri oku yine sessizce ölürdü. Artık ZİNCİR ölçülüyor.
    expect(shell).toMatch(/from ["']\.\/tabs\/tab-routers["']/);
    expect(shell).toMatch(/get(Boss)?TabRouter\(/);
    expect(shell).toContain("TabIdProvider");
    expect(shell).toContain("TabPortalProvider");
    expect(shell).not.toContain("createMemoryRouter");
  });

  it("⚠️ router fabrikaları TEK `build()` yolundan geçiyor (rota hafızası + geçmiş defteri)", () => {
    // Geri okunun TEK doğru kaynağı `history-depth` defteridir ve o defter
    // yalnız `build()` içinde besleniyor (`trackTabLocation` + `rememberRoute`).
    // `createMemoryRouter` bu dosyada TEK KEZ, `build()` içinde çağrılmalı.
    const factory = stripComments(read("src/components/layout/tabs/tab-routers.tsx"));
    expect(factory.length).toBeGreaterThan(500); // körlük zemini
    expect(factory.match(/createMemoryRouter\(/g) ?? []).toHaveLength(1);
    expect(factory).toMatch(/function build\([\s\S]*?createMemoryRouter\(/);
    // Özet görünümünün fabrikası da aynı yoldan: kendi router'ını kurmuyor.
    expect(factory).toMatch(/export function getBossTabRouter[\s\S]*?build\(/);
    // Kapılı kök layout bir ROUTER kurmaz, yalnız `Outlet`in önünde durur.
    const bossRoot = stripComments(read("src/components/layout/BossRootLayout.tsx"));
    expect(bossRoot.length).toBeGreaterThan(200); // körlük zemini
    expect(bossRoot).not.toContain("createMemoryRouter");
  });

  it("BossShell AppShell'i sarmıyor (sekme şeridi bypass)", () => {
    expect(shell).not.toContain("TabHost");
    expect(shell).not.toContain("<AppShell");
  });

  it("körlük zemini: dosyalar gerçekten okundu", () => {
    expect(app.length).toBeGreaterThan(500);
    expect(routes.length).toBeGreaterThan(2000);
    expect(shell.length).toBeGreaterThan(500);
  });
});

describe("patron rotası izin guard'ı TAŞIMAZ (bilinçli)", () => {
  it("ProtectedRoute ile sarılmamış", () => {
    const routes = read("src/routes/content-routes.tsx");
    const line = routes.split("\n").find((l) => l.includes("BOSS_PATH.slice"));
    expect(line).toBeTruthy();
    // Süzme SUNUCUDA, bölüm bazında (beş bölüm beş ayrı izne bakıyor). Route'a
    // tek bir izin koymak ya bölümü hak eden kullanıcıyı dışarıda bırakırdı ya
    // da hiçbir şeyi kapılamazdı.
    expect(line).not.toContain("ProtectedRoute");
  });
});
