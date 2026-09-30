// GENEL YOL (ERİŞİM, Cloudflare Access arkası) — kök parolası Cloudflare'den GEÇMEZ: ERISIM oturumunda
// "Lisansı imzala/yenile" düğmesi ve parola alanlı imza formu HİÇ açılmaz, yerine yol gösteren açıklama.
// Sunucu o ucu genel yolda 404'ler ama 404 parolanın CF'ye gitmesini engellemez — engel bu ekrandır.
// Pozitif kontrol: aynı ekran TAILNET oturumunda düğmeyi gösterir (kör gizleme yeşil veremez).
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor } from "./harness";

function openInstallation(dinleyici: SessionListener) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_YONETICI"), dinleyici } }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
    },
  });
}

describe("genel yolda kök parolalı imza kapalı", () => {
  it("TAILNET: yönetici 'Lisansı yenile' düğmesini görür, açıklama yok (pozitif kontrol)", async () => {
    openInstallation("TAILNET");
    expect(await screen.findByRole("button", { name: "Lisansı yenile" })).toBeInTheDocument();
    expect(screen.queryByText(/Cloudflare'den geçmez/)).toBeNull();
  });

  it("ERISIM: imza düğmesi ve parola alanı yok, tailnet/geri döngü yolu gösterilir, /surum çağrılmaz", async () => {
    const r = openInstallation("ERISIM");
    expect(await screen.findByText(/Cloudflare'den geçmez/)).toBeInTheDocument();
    expect(screen.getByText(/portal-baglan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lisansı (imzala|yenile)/ })).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(r.calls.some((c) => c.path.includes("/surum"))).toBe(false);
  });
});
