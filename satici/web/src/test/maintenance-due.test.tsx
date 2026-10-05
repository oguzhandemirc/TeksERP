// K9 — "Bakım bitişleri" sayfası: aşama/kalan gün sunucunun hükmünden; bitmiş ve yaklaşan satır ayrı rozetle; menüde görünür.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { MaintenanceDueRow } from "../shared/types";
import { INSTALLATION_DB_ID } from "./fixtures";
import { renderApp, sessionFor } from "./harness";

const row = (over: Partial<MaintenanceDueRow>): MaintenanceDueRow => ({
  id: INSTALLATION_DB_ID,
  kurulumId: "9e8d7c6b-0000-4000-8000-00000000abcd",
  hakId: "h1",
  ad: "Merkez sunucu",
  musteri: "Örnek Tekstil",
  tesis: "Ana tesis",
  sinif: "URETIM",
  durum: "ETKIN",
  lisansNo: "TKS-1",
  kalici: true,
  bakimBitis: "2026-10-20T00:00:00.000Z",
  kalanGun: 15,
  asama: "YAKLASIYOR",
  kuruluSurum: "2.13.1",
  kuruluDerleme: "2026-09-01T00:00:00.000Z",
  surumBakimDisi: false,
  ...over,
});

function open(data: MaintenanceDueRow[]) {
  renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/bakim-bitecek",
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
      "GET /bakim-bitecek": () => ({ data }),
    },
  });
}

describe("Bakım bitişleri sayfası", () => {
  it("⭐ bitmiş ve yaklaşan lisanslar sunucunun aşamasıyla; özet şeridi aynı satırlardan; kurulum bağlantısı; menü öğesi", async () => {
    open([
      row({ hakId: "h0", lisansNo: "TKS-0", kalanGun: -3, asama: "BITTI", surumBakimDisi: true }),
      row({}),
      row({ hakId: "h2", lisansNo: "TKS-2", kalanGun: 60, asama: "SONRAKI", surumBakimDisi: null, kuruluSurum: null }),
    ]);
    expect(await screen.findByText("3 lisans · 1 bitti · 1 30 gün içinde bitiyor")).toBeInTheDocument();
    expect(screen.getByText("Bitti")).toBeInTheDocument();
    expect(screen.getByText("3 gün önce bitti")).toBeInTheDocument();
    expect(screen.getByText("Yaklaşıyor")).toBeInTheDocument();
    expect(screen.getByText("15 gün")).toBeInTheDocument();
    expect(screen.getByText("Sonraki")).toBeInTheDocument();
    expect(screen.getByText("Evet (ek süre)")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Örnek Tekstil › Ana tesis › Merkez sunucu" })[0]).toHaveAttribute("href", `/kurulumlar/${INSTALLATION_DB_ID}`);
    expect(screen.getByRole("link", { name: "Bakım bitişleri" })).toBeInTheDocument();
  });

  it("negatif sonda: liste boşsa boş-durum cümlesi çıkar, satır/rozet yok", async () => {
    open([]);
    expect(await screen.findByText("Bakımı bitmiş ya da yakında bitecek lisans yok")).toBeInTheDocument();
    expect(screen.queryByText("Bitti")).toBeNull();
  });
});
