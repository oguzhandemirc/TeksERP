// T5 menü yeniden gruplama (2026-11-11) — hiçbir kart kaybolmadı, her kart TEK yerde, adresler aynı.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/layout/nav-config";
import { resolveTabMeta } from "@/components/layout/tabs/tab-meta";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { costTiles } from "@/pages/Cost/tile-config";
import { operationGroups } from "./groups-config";
import { SALES_COST_TILE_KEYS, allSectionTiles, sectionTiles } from "./sections";

/** T5 öncesi Operasyon hub'ının karo anahtarları (76841f42b, `tiles/*.ts`) — donmuş liste. */
const PRE_T5_OPERATIONS_KEYS = [
  "orders", "allocation-repair", "product-balance",
  "work-orders", "work-order-create", "work-order-events", "weaving-orders", "machine-stops", "weaving-floor",
  "loom-alarms", "warp-beams", "kartela", "kursun-dagitim", "kursun-sapmalar", "fason-kokpiti",
  "rolls", "yarn-stock", "goods-receipts", "sarf-stogu", "icerideki-isler", "emanet-cikis", "gelen-belgeler",
  "gelen-belge-sablonlari", "gelen-belge-tanit", "gelen-belge-varsayilan-urunler", "purchase-orders",
  "warehouse-transfers", "stock-counts", "sack-content-edit", "relabel-station",
  "shipments", "sevke-hazir-isler", "sack-store", "accounting-dispatch", "returns", "e-irsaliye",
];
const MOVED_TO_DEFINITIONS = ["gelen-belge-sablonlari", "gelen-belge-tanit", "gelen-belge-varsayilan-urunler"];
const keys = (group: Parameters<typeof sectionTiles>[0]) => sectionTiles(group).map((t) => t.key);

describe("T5 — hiçbir kart kaybolmadı", () => {
  it("⭐ eski Operasyon karolarının HER biri ya bir bölümde ya Tanımlar'da, tam bir kez", () => {
    const where = (k: string) => [
      ...allSectionTiles.filter((t) => t.key === k).map(() => "bölüm"),
      ...definitionTiles.filter((t) => t.key === k).map(() => "tanımlar"),
    ];
    const bad = PRE_T5_OPERATIONS_KEYS.filter((k) => where(k).length !== 1).map((k) => `${k}: ${where(k).join(",") || "YOK"}`);
    expect(bad).toEqual([]);
    expect(definitionTiles.filter((t) => MOVED_TO_DEFINITIONS.includes(t.key)).map((t) => t.group)).toEqual(["incoming", "incoming", "incoming"]);
  });

  it("⭐ teklifler Satış'ta; Maliyet karoları eksiksiz (Satış'a geçen + Maliyet'te kalan = tüm maliyet karoları)", () => {
    expect(keys("planning")).toEqual(expect.arrayContaining(["quotes"]));
    const inSales = costTiles.filter((t) => SALES_COST_TILE_KEYS.includes(t.key));
    expect(inSales.map((t) => t.key)).toEqual(["quotes"]);
    expect(costTiles.length - inSales.length).toBeGreaterThanOrEqual(8);
  });

  it("ekran adresleri değişmedi: eski Operasyon karoları `/operations/...` adresinde", () => {
    const all = [...allSectionTiles, ...definitionTiles];
    for (const k of PRE_T5_OPERATIONS_KEYS) expect(all.find((t) => t.key === k)?.to, k).toMatch(/^\/operations\//);
    expect(allSectionTiles.find((t) => t.key === "quotes")?.to).toBe("/cost/quotes");
  });

  it("bölümler arasında çift karo yok", () => {
    const ks = allSectionTiles.map((t) => t.key);
    expect(ks.length).toBe(new Set(ks).size);
  });
});

describe("T5 — bölüm içerikleri (kullanıcı kararı)", () => {
  it("Satış: siparişler, siparişe yazılamayanlar, kumaş dengesi, teklifler", () => {
    expect(keys("planning")).toEqual(["orders", "allocation-repair", "product-balance", "quotes"]);
  });
  it("Üretim: üretim grubunun tamamı + fason (kokpit, içerideki işler, emanet çıkış) sonda", () => {
    expect(keys("production").slice(-3)).toEqual(["fason-kokpiti", "icerideki-isler", "emanet-cikis"]);
    expect(keys("production")).toEqual(expect.arrayContaining(["work-orders", "weaving-orders", "kursun-dagitim", "kartela"]));
  });
  it("Depo: stoklar, paketleme, transfer, sayım, yeniden etiketle, alış, mal kabul, gelen belgeler", () => {
    expect([...keys("warehouse")].sort()).toEqual(
      ["rolls", "yarn-stock", "sarf-stogu", "sack-content-edit", "warehouse-transfers", "stock-counts", "relabel-station", "purchase-orders", "goods-receipts", "gelen-belgeler"].sort(),
    );
  });
  it("Sevkiyat: sevkiyat grubunun tamamı", () => {
    expect(keys("shipping")).toEqual(["shipments", "sevke-hazir-isler", "sack-store", "accounting-dispatch", "returns", "e-irsaliye"]);
  });
});

describe("T5 — menü kökleri", () => {
  const ROUTES = readFileSync(resolve(__dirname, "../../routes/content-routes.tsx"), "utf8");

  it("⭐ menü sırası: Anasayfa, Satış, Üretim, Depo, Sevkiyat, Kalite, Maliyet, Ön muhasebe, Raporlar, Tanımlar, Belgeler; ardından Yönetim", () => {
    expect(navGroups.map((g) => g.label)).toEqual(["Genel", "Yönetim"]);
    expect(navGroups[0]!.items.map((i) => i.to)).toEqual([
      "/", "/sales", "/production", "/warehouse", "/shipping", "/quality", "/cost", "/finance", "/reports", "/definitions", "/documents",
    ]);
    expect(navGroups[0]!.items.find((i) => i.to === "/cost")?.label).toBe("Maliyet");
    expect(navGroups.flatMap((g) => g.items).some((i) => i.to === "/operations")).toBe(false);
  });

  it("her bölüm kökü kendi bölüm sayfasına gider; route + sekme başlığı var; eski /operations çalışır", () => {
    for (const g of operationGroups) {
      const item = navGroups.flatMap((x) => x.items).find((i) => i.section === g.key);
      expect(item?.to, g.key).toBe(g.route);
      expect(item?.label).toBe(g.title);
      expect(ROUTES).toContain(`path: "${g.route.slice(1)}", element: <OperationsHubPage section="${g.key}" />`);
      expect(resolveTabMeta(g.route).title).toBe(g.title);
    }
    expect(ROUTES).toContain('{ path: "operations", element: <OperationsHubPage /> }');
  });

  it("bölüm kökleri bayrağa ve izne bağlanmaz (kapı karolarda; boş kök Sidebar'da düşer)", () => {
    for (const i of navGroups.flatMap((g) => g.items).filter((x) => x.section)) {
      expect(i.featureFlag, i.to).toBeUndefined();
      expect(i.permission ?? i.permissionAny, i.to).toBeUndefined();
    }
  });
});
