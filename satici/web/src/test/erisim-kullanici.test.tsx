// GENEL YOL (ERİŞİM, Cloudflare Access arkası) — kullanıcı yönetimi yalnız tailnet/geri döngüden: hesap açma, TOTP ve
// parola sıfırlama sırları Cloudflare'den GEÇMEZ. ERISIM oturumunda "Portal kullanıcıları" menüde yok, sayfa yol
// gösteren açıklama çizer ve /kullanicilar'ı ÇAĞIRMAZ (sunucu o uçları orada zaten 404'ler).
// Pozitif kontrol: aynı ekran TAILNET oturumunda menü öğesini ve listeyi gösterir (kör gizleme yeşil veremez).
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import { renderApp, sessionFor } from "./harness";

function openUsers(dinleyici: SessionListener) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/kullanicilar",
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_YONETICI"), dinleyici } }),
      "GET /kullanicilar": () => ({ data: [] }),
      "GET /bayiler": () => ({ data: [] }),
    },
  });
}

describe("genel yolda kullanıcı yönetimi kapalı", () => {
  it("TAILNET: menüde 'Portal kullanıcıları' var, sayfa listeyi çağırır, 'Yeni kullanıcı' düğmesi var (pozitif kontrol)", async () => {
    const r = openUsers("TAILNET");
    expect(await screen.findByRole("button", { name: "Yeni kullanıcı" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portal kullanıcıları" })).toBeInTheDocument();
    expect(r.calls.some((c) => c.path === "/kullanicilar")).toBe(true);
  });

  it("ERISIM: menüde yok, sayfa tailnet/geri döngü yolunu anlatır, /kullanicilar çağrılmaz, form düğmesi yok", async () => {
    const r = openUsers("ERISIM");
    expect(await screen.findByText(/Cloudflare'den geçmez/)).toBeInTheDocument();
    expect(screen.getByText(/portal-baglan/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Portal kullanıcıları" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Yeni kullanıcı" })).toBeNull();
    expect(r.calls.some((c) => c.path.startsWith("/kullanicilar"))).toBe(false);
  });
});
