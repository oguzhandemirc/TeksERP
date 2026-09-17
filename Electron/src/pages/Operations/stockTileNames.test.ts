// =============================================================================
// BEKÇİ — Depo & Paketleme stok karoları: "Kumaş Stoğu" · "İplik Stoğu" (1e kararı 2026-09-17 03:55)
// =============================================================================
// ⭐ §1 Ad: stok ekranı MALZEME SINIFINA göre adlanır — "Envanter" yalnız topları kapsıyordu ama her şeyi
//    kapsıyormuş gibi okunuyordu; "İplik Kg-Stok" birim adıyla adlanmıştı. Route/izin/key DEĞİŞMEZ.
// ⭐ §2 Sıra: iki stok karosu YAN YANA (1. ve 2.), Mal Kabul 3.
// ⭐ §3 Ayna: backend ekran kataloğu title'ı karoyla AYNI (iki kaynak ayrışmasın).
// ⭐ §4 Kaynak taraması: eski adlar karo/palet/katalog/sayfa başlığı ve sayfa içi metin yüzeyinde 0 —
//    Raporlar alanı bu dilimin DIŞINDA (1e: ölç, listele, dokunma) → evren dışı, aşağıda beyanlı.
// =============================================================================
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { operationsTiles } from "./tile-config";

const tile = (key: string) => operationsTiles.find((t) => t.key === key)!;
const BACKEND_CATALOG = resolve(process.cwd(), "../Teks-Erp/src/constants/screen-catalog.ts");

/** Taranan yüzey — ekran adının GEÇTİĞİ dosyalar (karo · hub açıklaması · palet · sayfa başlığı · sayfa içi metin · katalog). */
const SURFACE = [
  "src/pages/Operations/tile-config.ts",
  "src/pages/Operations/groups-config.ts",
  "src/components/layout/command-entries.ts",
  "src/components/layout/command-entries.deep.ts",
  "src/lib/search/search-targets.ts",
  "src/lib/scanner/scan-resolvers.ts",
  "src/pages/Operations/Rolls/RollsPage.tsx",
  "src/pages/Operations/Rolls/inventorySummary.ts",
  "src/pages/Operations/Rolls/QuickShipDialog.tsx",
  "src/pages/Operations/Yarn/YarnStockPage.tsx",
  "src/pages/Operations/GoodsReceipts/receiptFeedback.ts",
  "src/pages/Operations/GoodsReceipts/GoodsReceiptDetailSheet.tsx",
  "src/pages/Operations/Kartela/KartelaPage.tsx",
  "src/pages/Boss/cards/BossCards.tsx",
  "src/pages/GeneralSettings/settings-config.ts",
].map((p) => resolve(process.cwd(), p));
/** Evren DIŞI (dokunulmadı, beyanlı): Raporlar hub'ı — "envanter" rapor terimi ayrı dilim. */
const EVREN_DISI_RAPOR = ["src/pages/Reports/Inventory/StockScorecardPage.tsx", "src/pages/Reports/Inventory/stockScorecard.ts"];
const ESKI_AD = /Envanter|Kg-Stok/;

describe("stok karoları — Kumaş Stoğu · İplik Stoğu", () => {
  it("⭐ §1 karo adı ve alt açıklama; route/izin/key aynen", () => {
    expect(tile("rolls")).toMatchObject({ title: "Kumaş Stoğu", description: "Toplar — depo, statü, metraj", to: "/operations/rolls", permission: "roll:read", group: "warehouse" });
    expect(tile("yarn-stock")).toMatchObject({ title: "İplik Stoğu", description: "Lotlar — kg bakiyesi", to: "/operations/yarn-stock", permission: "warehouse:read", group: "warehouse" });
  });

  it("⭐ §2 sıra: Kumaş Stoğu 1 · İplik Stoğu 2 · Mal Kabul 3 (depo grubunda)", () => {
    const warehouse = operationsTiles.filter((t) => t.group === "warehouse").map((t) => t.key);
    expect(warehouse.slice(0, 3)).toEqual(["rolls", "yarn-stock", "goods-receipts"]);
  });

  it("⭐ §3 backend ekran kataloğu title'ı karoyla aynı (iki ekran)", () => {
    expect(existsSync(BACKEND_CATALOG), "backend kataloğu bulunamadı — ÖLÇÜLEMEDİ").toBe(true);
    const katalog = readFileSync(BACKEND_CATALOG, "utf8");
    const title = (key: string) => katalog.match(new RegExp(`key: "${key}"[^\\n]*title: "([^"]+)"`))?.[1];
    expect(title("operations/rolls")).toBe(tile("rolls").title);
    expect(title("operations/yarn-stock")).toBe(tile("yarn-stock").title);
  });

  it("⭐ §4 eski adlar yüzeyde 0; rapor alanı evren dışı ve HÂLÂ eski terimi taşıyor (beyan ↔ gerçek)", () => {
    const ihlal: string[] = [];
    for (const f of [...SURFACE, BACKEND_CATALOG]) {
      expect(existsSync(f), `yüzey dosyası bulunamadı — ÖLÇÜLEMEDİ: ${f}`).toBe(true);
      readFileSync(f, "utf8").split("\n").forEach((satir, i) => {
        if (ESKI_AD.test(satir)) ihlal.push(`${f.replace(process.cwd() + "/", "")}:${i + 1}: ${satir.trim()}`);
      });
    }
    expect(ihlal, "eski ad geri geldi — Kumaş Stoğu / İplik Stoğu").toEqual([]);
    // Evren dışı beyanı ölü kalmasın: rapor dosyaları hâlâ eski terimi taşıyor (dilim açıldığında bu satır düşer).
    for (const p of EVREN_DISI_RAPOR) expect(readFileSync(resolve(process.cwd(), p), "utf8")).toMatch(/Envanter/);
  });
});
