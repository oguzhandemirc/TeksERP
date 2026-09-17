// =============================================================================
// DOKUMA RAPORLARI GÖRÜNÜRLÜĞÜ + ORAN BİÇİMİ — BEKÇİ
// =============================================================================
// Karo yüklemi bileşen içi `&&` zinciri olsaydı tersine çevrilmesi hiçbir testi
// kırmazdı: referans fabrikada (dokuma.enabled KAPALI) karo belirirdi. İkinci iş:
// `null` oran "ölçülemedi"dir, `%0` değil — çökertme sessizce yanlış karar doğurur.
// =============================================================================
import { describe, expect, it } from "vitest";
import { regimePredicate } from "@/lib/regime-predicate";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { reportCategoryTiles, reportTiles } from "../tile-config";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";

const dokumaKaro = reportTiles.find((t) => t.key === "dokuma");
const ctx = (over: Partial<OperationsVisibilityContext>): OperationsVisibilityContext =>
  ({ dokumaEnabled: false, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false, productionEnabled: true, financeEnabled: false, ticaretEnabled: false, iplikEnabled: false, depoMultiEnabled: false, devereEnabled: false, tezgahEnabled: false, ...over }) as OperationsVisibilityContext;

describe("rejim (Raporlar hub'ı karosu)", () => {
  it("⭐ karo `dokumaEnabled` bayrağına bağlı ve izni `report:production` (route ile ayna)", () => {
    expect(dokumaKaro?.featureFlag).toBe("dokumaEnabled");
    expect(dokumaKaro?.permission).toBe("report:production");
    expect(dokumaKaro?.to).toBe("/reports/dokuma");
  });
  it("⭐ fabrikada (dokuma modülü kapalı) GÖRÜNMEZ — bayrak yüklemi false", () => {
    expect(regimePredicate(dokumaKaro!.featureFlag!)(ctx({ dokumaEnabled: false }))).toBe(false);
  });
  it("dokuma modülü açıkken görünür", () => {
    expect(regimePredicate(dokumaKaro!.featureFlag!)(ctx({ dokumaEnabled: true }))).toBe(true);
  });
  it("alt raporlar üç segmentli adres taşır (ReportSideRail şartı) ve kategori kayıtlı", () => {
    for (const t of reportCategoryTiles.dokuma ?? []) expect(t.to.split("/").filter(Boolean)).toHaveLength(3);
    expect(reportCategoryTiles.dokuma?.length).toBe(4);
  });
});

describe("oran biçimi", () => {
  it("⭐ null → 'ölçülemedi' (0 değil, boş değil)", () => {
    expect(formatPct(null)).toBe("ölçülemedi");
    expect(formatPct(undefined)).toBe("ölçülemedi");
  });
  it("sayı → yüzde, bir hane", () => {
    expect(formatPct(87.5)).toBe("%87,5");
    expect(formatPct(0)).toBe("%0,0");
  });
  it("⭐ SIMULATED ile OPERATOR etiketi AYRI (güven sınıfı birleştirilmez)", () => {
    expect(SOURCE_LABELS.SIMULATED).not.toBe(SOURCE_LABELS.OPERATOR);
    expect(Object.keys(SOURCE_LABELS)).toEqual(["MACHINE", "OPERATOR", "SUPERVISOR", "SIMULATED", "INFERRED"]);
  });
});
