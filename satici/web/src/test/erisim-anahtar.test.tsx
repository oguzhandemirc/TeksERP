// GENEL YOL (ERİŞİM, Cloudflare Access arkası) — güven kökü EKLEYEN anahtar kayıtları yalnız tailnet/geri döngüden
// (en az yetki): bayi imza anahtarı bağlama ve yayıncı anahtarı kaydı düğmesi ERISIM oturumunda çizilmez, yerine yol
// gösteren açıklama; aynı ekranın öteki yönetim düğmeleri (tavan, pasife alma) kalır. Pozitif kontrol: TAILNET
// oturumunda düğmeler görünür (kör gizleme yeşil veremez).
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import { renderApp, sessionFor } from "./harness";

const TAVAN = { id: "t1", surum: 1, moduller: [], siniflar: ["URETIM"], kurulumAdedi: 3, kanallar: [], kaliciIzni: false, bakimAyTavani: 12, sebep: "ilk", yapan: "satici:yonetici", createdAt: "2026-09-30T10:00:00Z" };
const BAYI = { id: "b1", ad: "Örnek Bayi", vergiNo: null, anahtarKid: null, guncelTavanSurum: 1, aktif: true, createdAt: "2026-09-30T10:00:00Z", tavan: TAVAN, kullanim: 0, tavanGecmisi: [TAVAN], musteriSayisi: 0, kullanicilar: [] };

function openDealer(dinleyici: SessionListener) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/bayiler/b1",
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_YONETICI"), dinleyici } }),
      "GET /bayiler/b1": () => ({ data: BAYI }),
      "GET /kanallar": () => ({ data: [] }),
      "GET /katalog": () => ({ data: { moduller: [], varsayilanModuller: [], siniflar: ["URETIM"], kademeler: [], kisitlamaGunSecenekleri: [], roller: [] } }),
    },
  });
}

function openReleases(dinleyici: SessionListener) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/surumler",
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_YONETICI"), dinleyici } }),
      "GET /surumler": () => ({ data: { yayinKoku: "BAGLI_DEGIL", kanallar: [] } }),
      "GET /yayincilar": () => ({ data: [{ id: "p1", kid: "yayinci-mac-1", ad: "Mac", aktif: true, createdAt: "2026-09-30T10:00:00Z" }] }),
    },
  });
}

describe("genel yolda anahtar kaydı kapalı", () => {
  it("TAILNET: bayi ekranında 'Anahtar bağla', sürümlerde 'Anahtar kaydet' var (pozitif kontrol)", async () => {
    openDealer("TAILNET");
    expect(await screen.findByRole("button", { name: "Anahtar bağla" })).toBeInTheDocument();
    expect(screen.queryByText(/Anahtar kaydı güven kökü ekler/)).toBeNull();
  });

  it("ERISIM: bayi ekranında 'Anahtar bağla' YOK, tavan/pasif düğmeleri var, tailnet yolunu anlatan açıklama var", async () => {
    openDealer("ERISIM");
    expect(await screen.findByRole("button", { name: "Tavanı değiştir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pasife al" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anahtar bağla|Anahtarı değiştir/ })).toBeNull();
    expect(screen.getByText(/Anahtar kaydı güven kökü ekler[^]*portal-baglan/)).toBeInTheDocument();
  });

  it("TAILNET: sürümlerde 'Anahtar kaydet' var (pozitif kontrol)", async () => {
    openReleases("TAILNET");
    expect(await screen.findByRole("button", { name: "Anahtar kaydet" })).toBeInTheDocument();
  });

  it("ERISIM: sürümlerde 'Anahtar kaydet' YOK, açıklama var; yayıncıyı pasife alma (güveni daraltır) kalır", async () => {
    openReleases("ERISIM");
    expect(await screen.findByText(/Anahtar kaydı güven kökü ekler[^]*portal-baglan/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anahtar kaydet" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Pasife al" })).toBeInTheDocument();
  });
});
