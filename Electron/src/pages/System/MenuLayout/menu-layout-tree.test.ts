import { describe, expect, it } from "vitest";
import type { ScreenEntry } from "@/services/screenCatalogService";
import { groupScreens, tileRootOf } from "./menu-layout-tree";

// Menü Düzeni grupları kenar menünün bölümleriyle aynı olmalı: ekran adresi `/operations/...` kalsa da
// grup KARODAN çözülür (Satış/Üretim/Depo/Sevkiyat), eski tek "Operasyon" grubu yok.

const ekran = (key: string, app: ScreenEntry["app"] = "desktop"): ScreenEntry =>
  ({ key, app, title: key, requires: [], capabilities: [] }) as unknown as ScreenEntry;

const grupOf = (key: string) => groupScreens([ekran(key)])[0]?.id;

describe("tileRootOf", () => {
  it("bölüm karoları kendi bölümüne düşer", () => {
    expect(tileRootOf("operations/orders")).toBe("planning");
    expect(tileRootOf("cost/quotes")).toBe("planning");
    expect(tileRootOf("operations/work-orders")).toBe("production");
    expect(tileRootOf("operations/shipments")).toBe("shipping");
  });

  it("alt adres en uzun eşleşen karonun kökünü alır", () => {
    expect(tileRootOf("operations/gelen-belgeler/sablonlar")).toBe("definitions");
    expect(tileRootOf("operations/work-orders/new")).toBe("production");
  });

  it("karosu olmayan adres null", () => {
    expect(tileRootOf("operations/yok-boyle-ekran")).toBeNull();
    expect(tileRootOf("operations")).toBeNull();
  });
});

describe("groupScreens — menü bölümleri", () => {
  it("operations/* ekranları bölümlere, Teklifler Satış'a dağılır", () => {
    expect(grupOf("operations/orders")).toBe("planning");
    expect(grupOf("cost/quotes")).toBe("planning");
    expect(grupOf("operations/work-orders")).toBe("production");
    expect(grupOf("operations/rolls")).toBe("warehouse");
    expect(grupOf("operations/shipments")).toBe("shipping");
    expect(grupOf("operations/gelen-belgeler/sablonlar")).toBe("definitions");
  });

  it("eski Operasyon grubu yok; Maliyet başlığı sade", () => {
    const g = groupScreens([ekran("operations/orders"), ekran("cost/yarn-need"), ekran("operations/yok-boyle-ekran")]);
    expect(g.map((x) => x.id)).toEqual(["planning", "cost", "other"]);
    expect(g.map((x) => x.title)).toEqual(["Satış", "Maliyet", "Diğer"]);
    expect(g.some((x) => x.title === "Operasyon")).toBe(false);
  });

  it("bölüm sırası kenar menü sırasıdır", () => {
    const g = groupScreens(["operations/shipments", "operations/rolls", "operations/work-orders", "operations/orders"].map((k) => ekran(k)));
    expect(g.map((x) => x.id)).toEqual(["planning", "production", "warehouse", "shipping"]);
  });
});
