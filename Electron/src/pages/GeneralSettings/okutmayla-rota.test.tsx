// K29 okutmayla rota: ayar satırları (varsayılan = bugünkü SIRALI), istasyon anahtarları gövdeye gider,
// İE rota şeridinde "Sahada eklendi" / "Okutmayla atlandı" rozeti; eski adımda rozet yok.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";
import { FLAG_MODULE } from "@/pages/GeneralSettings/flag-modules";
import { buildStationPayload } from "@/pages/Stations/stationPayload";
import { stationFormDefaults } from "@/pages/Stations/schema";
import { capabilityChips } from "@/pages/Stations/StationListRow";
import type { Station } from "@/pages/Stations/types";
import { stepOriginLabel } from "@/pages/Operations/WorkOrders/step-state";
import { RouteStepline } from "@/pages/Operations/WorkOrders/detail-v3/RouteStepline";
import type { WorkOrderStepLite } from "@/pages/Operations/WorkOrders/types";

const flagOf = (key: string) => SETTINGS_CATEGORIES.flatMap((c) => c.enumFlags ?? []).find((f) => f.enumKey === key);

describe("okutmayla rota ayar satırları", () => {
  it("Rota uygulaması: varsayılan SEQUENTIAL (bugünkü), seçenekler SEQUENTIAL/SCAN, Üretim modülüne bağlı", () => {
    const f = flagOf("productionRouteMode");
    expect(f?.defaultValue).toBe("SEQUENTIAL");
    expect(f?.options.map((o) => o.value)).toEqual(["SEQUENTIAL", "SCAN"]);
    expect(FLAG_MODULE.productionRouteMode).toBe("productionEnabled");
  });
  it("istasyon kapsamı: varsayılan SELECTED, seçenekler SELECTED/ALL", () => {
    const f = flagOf("productionScanRouteStations");
    expect(f?.defaultValue).toBe("SELECTED");
    expect(f?.options.map((o) => o.value)).toEqual(["SELECTED", "ALL"]);
  });
});

describe("istasyon anahtarları", () => {
  it("varsayılan kapalı ve gövdeye gider (sessiz allowlist değil)", () => {
    expect(stationFormDefaults.scanAddAllowed).toBe(false);
    expect(stationFormDefaults.scanNotSkippable).toBe(false);
    const body = buildStationPayload({ ...stationFormDefaults, name: "Detaylı KK", scanAddAllowed: true, scanNotSkippable: true }, null);
    expect(body.scanAddAllowed).toBe(true);
    expect(body.scanNotSkippable).toBe(true);
  });
  it("liste rozetleri", () => {
    const chips = capabilityChips({ appliesColor: false, appliesProperty: false, appliesQuality: false, inspectionEnabled: false, producesWarpBeam: false, consumesWarpBeam: false, scanAddAllowed: true, scanNotSkippable: true } as Station);
    expect(chips).toEqual(["Okutunca eklenir", "Atlanamaz"]);
  });
});

describe("İE adım rozeti", () => {
  const step = (p: Partial<WorkOrderStepLite>): WorkOrderStepLite => ({ id: p.id ?? "s", stepSequence: p.stepSequence ?? 1, status: "PENDING", station: { id: "x", code: "X", name: p.id ?? "İstasyon" }, ...p });
  it("etiketler: sahada eklendi / okutmayla atlandı / diğer atlamalar ve plan adımı rozetsiz", () => {
    expect(stepOriginLabel({ addedVia: "SCAN", status: "ACTIVE" })).toBe("Sahada eklendi");
    expect(stepOriginLabel({ addedVia: null, status: "SKIPPED", skipReason: "SCAN_SKIP" })).toBe("Okutmayla atlandı");
    expect(stepOriginLabel({ addedVia: null, status: "SKIPPED", skipReason: "WO_CANCELLED" })).toBeNull();
    expect(stepOriginLabel({ status: "PENDING" })).toBeNull();
  });
  it("rota şeridinde rozet çizilir; eski yanıtta (alan yok) çizilmez", () => {
    render(<RouteStepline steps={[step({ id: "Kurşun", status: "SKIPPED", skipReason: "SCAN_SKIP" }), step({ id: "Detaylı KK", stepSequence: 2, addedVia: "SCAN" }), step({ id: "Tambur", stepSequence: 3 })]} />);
    expect(screen.getAllByTestId("step-origin-badge").map((b) => b.textContent)).toEqual(["Okutmayla atlandı", "Sahada eklendi"]);
  });
});
