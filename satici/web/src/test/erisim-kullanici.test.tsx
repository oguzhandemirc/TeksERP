// İNTERNET PORTALI (ERİŞİM, Cloudflare Access arkası) — kullanıcı yönetimi TAILNET ile AYNI açık (kullanıcı kararı
// 2026-10-04): ERISIM oturumunda "Portal kullanıcıları" menüde var, sayfa /kullanicilar'ı çağırır, "Yeni kullanıcı"
// düğmesi var ve "tünelden yönetilir" açıklaması YOK. Pozitif kontrol: aynı ekran TAILNET'te aynı görünür.
// NEGATİF SONDA (2026-10-04, dosya DIŞI, shasum ile geri alındı): Users.tsx'e eski ERISIM açıklama dalı → ERISIM testi ❌
// (TAILNET yeşil); Layout.tsx menüsüne ERISIM'de `kullanici:yonet` süzgeci → ERISIM testi ❌ (+ mirrors ❌).
import { screen, waitFor } from "@testing-library/react";
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

describe("internet portalında kullanıcı yönetimi açık", () => {
  it("TAILNET: menüde 'Portal kullanıcıları' var, sayfa listeyi çağırır, 'Yeni kullanıcı' düğmesi var (pozitif kontrol)", async () => {
    const r = openUsers("TAILNET");
    expect(await screen.findByRole("button", { name: "Yeni kullanıcı" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portal kullanıcıları" })).toBeInTheDocument();
    await waitFor(() => expect(r.calls.some((c) => c.path === "/kullanicilar")).toBe(true));
  });

  it("ERISIM: menüde var, sayfa /kullanicilar'ı çağırır, 'Yeni kullanıcı' düğmesi var, tünel açıklaması yok", async () => {
    const r = openUsers("ERISIM");
    expect(await screen.findByRole("button", { name: "Yeni kullanıcı" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portal kullanıcıları" })).toBeInTheDocument();
    expect(screen.queryByText(/Cloudflare'den geçmez|portal-baglan/)).toBeNull();
    await waitFor(() => expect(r.calls.some((c) => c.path === "/kullanicilar")).toBe(true));
  });
});
