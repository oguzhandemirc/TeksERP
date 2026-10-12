import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail } from "@/types/license";
import { LicenseModeBand } from "./LicenseModeBand";

// Bant yalnız `durum.kip`, `hesaplananKademe`, `uygulananKademe`, `ekSureKalanGun` okur.
function detay(durum: Partial<LicenseDetail["durum"]>): LicenseDetail {
  return { durum: { ekSureKalanGun: null, ...durum } } as unknown as LicenseDetail;
}
const etkin = (k: string): string | null => screen.getByTestId(`lisans-basamak-${k}`).getAttribute("data-etkin");

/** LİSANS EKRANI — kip + kademe bandı (G3): zorlamada uygulanan basamak, gözlemde hesaplanan soluk. */
describe("Lisans ekranı — kip ve kademe bandı", () => {
  it("⭐ zorla + KISITLI: Zorlama etiketi, yalnız Kısıtlı basamağı vurgulu", () => {
    renderWithProviders(<LicenseModeBand d={detay({ kip: "zorla", hesaplananKademe: "KISITLI", uygulananKademe: "KISITLI" })} />);
    expect(screen.getByTestId("lisans-kip").textContent).toBe("Zorlama");
    expect([etkin("UYARI"), etkin("EK_SURE"), etkin("KISITLI")]).toEqual(["0", "0", "1"]);
  });

  it("zorla + EK_SURE: kalan gün yazılır", () => {
    renderWithProviders(<LicenseModeBand d={detay({ kip: "zorla", hesaplananKademe: "EK_SURE", uygulananKademe: "EK_SURE", ekSureKalanGun: 12 })} />);
    expect(etkin("EK_SURE")).toBe("1");
    expect(screen.getByText(/ek süre 12 gün/)).toBeTruthy();
  });

  it("⭐ gözlem: uygulanan NORMAL olsa da hesaplanan basamak gösterilir ve 'uygulanmaz' denir", () => {
    renderWithProviders(<LicenseModeBand d={detay({ kip: "gozlem", hesaplananKademe: "UYARI", uygulananKademe: "NORMAL" })} />);
    expect(screen.getByTestId("lisans-kip").textContent).toBe("Gözlem");
    expect(etkin("UYARI")).toBe("1");
    expect(screen.getByText(/gözlemde uygulanmaz/)).toBeTruthy();
  });

  it("NORMAL: hiçbir basamak vurgulu değil", () => {
    renderWithProviders(<LicenseModeBand d={detay({ kip: "zorla", hesaplananKademe: "NORMAL", uygulananKademe: "NORMAL" })} />);
    expect([etkin("UYARI"), etkin("EK_SURE"), etkin("KISITLI")]).toEqual(["0", "0", "0"]);
  });
});
