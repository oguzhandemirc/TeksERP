import { describe, it, expect } from "vitest";
import {
  BOSS_ALLOWED_SEGMENTS,
  buildBossMenu,
  isBossAllowedPath,
  type BossMenuInput,
} from "./boss-menu";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { reportTiles } from "@/pages/Reports/tile-config";

/**
 * ÖZET GÖRÜNÜMÜ (BossShell) YÜZEY DARALTMASI — bekçi.
 *
 * ⭐ ASIL İDDİA İKİ AYAKLI ve tek ayak yeşil kalırsa bu dosya hiçbir şey
 * kanıtlamaz:
 *   ① Menü YALNIZ Operasyon + Rapor çizer (fazlalık yüzey gözükmez), ve
 *   ② menüde çizilmeyen yol AÇILAMAZ da (hash ile doğrudan gidilirse kapı).
 * ①'i test edip ②'yi bırakmak, daraltmayı bir görsel süse indirger.
 *
 * ⭐ ÜÇÜNCÜ AYAK — HİZA. Menü karo kataloglarından TÜRETİLİR; katalogda görünen
 * her operasyon/rapor karosunun yolu kapıdan da geçmek ZORUNDA. Ayrışırsa
 * kullanıcı menüde gördüğü bağlantıya tıklar ve "bu ekran yok" sayfasına düşer
 * (`tile-config.permissionAny` ↔ route ayrışmasının birebir sınıfı).
 */

function ctx(over: Partial<OperationsVisibilityContext> = {}): OperationsVisibilityContext {
  return {
    shipmentConfirmationEnabled: false,
    depoMultiEnabled: false,
    financeEnabled: false,
    productionEnabled: true,
    ticaretEnabled: false,
    iplikEnabled: false,
    devereEnabled: false,
    // Dokuma işi de ETKİN değer (production && dokuma); fabrikada KAPALI.
    dokumaEnabled: false,
    reportsClosedKeys: [],
    isReportOpen: () => true,
    ...over,
  };
}

/** Tam yetkili kullanıcı — daraltmanın İZİNDEN değil KABUKTAN geldiğini ölçmek
 *  için: her şeye yetkisi olan biri de fazlalık yüzeyi görmemeli. */
function allPerms(over: Partial<BossMenuInput> = {}): BossMenuInput {
  return {
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isAdmin: true,
    ctx: ctx(),
    ...over,
  };
}

describe("isBossAllowedPath — kapı", () => {
  it("Operasyon ve Rapor yolları açık (alt yollar dahil)", () => {
    for (const p of [
      "/boss",
      "/operations",
      "/operations/rolls",
      "/operations/work-orders/abc-123",
      "/operations/shipments/direct/9",
      "/reports",
      "/reports/sales/open-order-coverage",
      "/forbidden",
    ]) {
      expect(isBossAllowedPath(p), p).toBe(true);
    }
  });

  it("fazlalık yüzeyler KAPALI", () => {
    for (const p of [
      "/definitions",
      "/definitions/items",
      "/definitions/traveler-card-studio",
      "/access/users",
      "/access/permissions",
      "/system",
      "/system/settings",
      "/system/feature-flags",
      "/system/db-restore",
      "/finance/invoices",
      "/settings",
    ]) {
      expect(isBossAllowedPath(p), p).toBe(false);
    }
  });

  it("körlük zemini: kapı gerçekten AYIRIYOR (hepsine true/false demiyor)", () => {
    expect(isBossAllowedPath("/operations/rolls")).toBe(true);
    expect(isBossAllowedPath("/system/settings")).toBe(false);
    expect(BOSS_ALLOWED_SEGMENTS.size).toBeGreaterThanOrEqual(4);
  });

  it("segment sınırında eşleşir — ön ek benzerliği kapıyı açmaz", () => {
    // ⚠️ Düz `startsWith("operations")` olsaydı bu yollar SESSİZCE açılırdı.
    expect(isBossAllowedPath("/operations-archive")).toBe(false);
    expect(isBossAllowedPath("/reportsx/anything")).toBe(false);
    expect(isBossAllowedPath("/bossy")).toBe(false);
  });

  it("kök ve boş yol kapıdan geçmez (yönlendirme BossRootLayout'un işi)", () => {
    expect(isBossAllowedPath("/")).toBe(false);
    expect(isBossAllowedPath("")).toBe(false);
  });

  it("sorgu/hash ve büyük harf kapıyı atlatamaz", () => {
    expect(isBossAllowedPath("/operations/rolls?tab=KANBAN")).toBe(true);
    expect(isBossAllowedPath("/OPERATIONS/rolls")).toBe(true);
    expect(isBossAllowedPath("/System/settings")).toBe(false);
    expect(isBossAllowedPath("/system/settings?x=1")).toBe(false);
  });
});

describe("buildBossMenu — yalnız Operasyon + Rapor", () => {
  it("TAM YETKİLİ kullanıcıda bile fazlalık yüzey yok", () => {
    const sections = buildBossMenu(allPerms());
    const targets = sections.flatMap((s) => s.items.map((i) => i.to));
    expect(targets.length).toBeGreaterThan(5); // körlük zemini: menü boş değil
    for (const to of targets) {
      expect(
        to.startsWith("/operations/") || to.startsWith("/reports"),
        `menüde fazlalık yüzey: ${to}`,
      ).toBe(true);
    }
  });

  it("HİZA: menüdeki her bağlantı kapıdan geçer", () => {
    // ⭐ Bu, ②'nin ①'i yalanlamadığının kanıtı. Kapı daraltılırsa (ya da bir karo
    // yolu değişirse) burada kırmızı verir, sahada "tıkla-ve-boş-sayfa" ile değil.
    const sections = buildBossMenu(allPerms());
    for (const s of sections) {
      for (const i of s.items) {
        expect(isBossAllowedPath(i.to), `${i.key} → ${i.to}`).toBe(true);
      }
    }
  });

  it("izin süzgeci uygulanır — yetkisiz kullanıcıda menü boş", () => {
    const sections = buildBossMenu({
      hasPermission: () => false,
      hasAnyPermission: () => false,
      isAdmin: false,
      ctx: ctx(),
    });
    expect(sections).toEqual([]);
  });

  it("modül anahtarı kapalıyken o karolar çizilmez (üretim kapalı)", () => {
    const acik = buildBossMenu(allPerms({ ctx: ctx({ productionEnabled: true }) }));
    const kapali = buildBossMenu(allPerms({ ctx: ctx({ productionEnabled: false }) }));
    const keys = (ss: ReturnType<typeof buildBossMenu>) =>
      ss.flatMap((s) => s.items.map((i) => i.key));
    expect(keys(acik)).toContain("work-orders");
    expect(keys(kapali)).not.toContain("work-orders");
    // Rapor tarafı da aynı bayrağı taşıyor (`reportTiles.featureFlag`).
    expect(keys(acik)).toContain("production");
    expect(keys(kapali)).not.toContain("production");
  });

  it("menü KOPYA değil TÜRETİLMİŞ — katalogdaki koşulsuz karolar eksiksiz gelir", () => {
    // ⚠️ Elle yazılmış bir menü ilk yeni karoda bayatlardı. Burada katalogla
    // birebirlik ölçülüyor: koşulsuz (bayraksız) operasyon karolarının hepsi ve
    // rapor kategorilerinin bayraksız olanlarının hepsi menüde olmalı.
    const keys = buildBossMenu(allPerms()).flatMap((s) => s.items.map((i) => i.key));
    const beklenenOps = operationsTiles.filter((t) => !t.visibleWhen).map((t) => t.key);
    const beklenenRapor = reportTiles.filter((t) => !t.featureFlag).map((t) => t.key);
    expect(beklenenOps.length).toBeGreaterThan(0);
    expect(beklenenRapor.length).toBeGreaterThan(0);
    for (const k of [...beklenenOps, ...beklenenRapor]) expect(keys, k).toContain(k);
  });

  it("bölümler akış sırasını korur ve Raporlar SONDA", () => {
    const sections = buildBossMenu(allPerms());
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[sections.length - 1]?.key).toBe("reports");
    expect(sections.slice(0, -1).every((s) => s.key.startsWith("ops:"))).toBe(true);
  });
});
