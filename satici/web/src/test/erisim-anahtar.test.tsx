// İNTERNET PORTALI (ERİŞİM, Cloudflare Access arkası) — anahtar kayıtları dinleyiciden bağımsız AYNI açık (kullanıcı kararı
// 2026-10-04): bayi imza anahtarı bağlama ("Anahtar bağla") ve yayıncı anahtarı kaydı ("Anahtar kaydet") düğmeleri ERISIM
// oturumunda çizilir, "güven kökü ekler ve bu bağlantıdan yapılamaz" açıklaması YOK; öteki yönetim düğmeleri (tavan, pasife
// alma) yerinde kalır. Pozitif kontrol: GENEL oturumunda düğmeler aynı görünür (dinleyici izni daraltmaz) (kör gizleme/kör açma yeşil veremez).
// NEGATİF SONDA (2026-10-04, dosya DIŞI, shasum ile geri alındı): DealerDetail.tsx'te `canKey` ERISIM'de false → bayi
// ERISIM testi ❌ (GENEL yeşil); Releases.tsx'te `canRegister` ERISIM'de false → sürümler ERISIM testi ❌; session.tsx
// `useCan` ERISIM'de bayi:anahtar/yayinci:anahtar false → iki ERISIM testi ❌.
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

describe("internet portalında anahtar kaydı açık", () => {
  it("GENEL: bayi ekranında 'Anahtar bağla', sürümlerde 'Anahtar kaydet' var (pozitif kontrol)", async () => {
    openDealer("GENEL");
    expect(await screen.findByRole("button", { name: "Anahtar bağla" })).toBeInTheDocument();
    expect(screen.queryByText(/Anahtar kaydı güven kökü ekler/)).toBeNull();
  });

  it("ERISIM: bayi ekranında 'Anahtar bağla' VAR, tavan/pasif düğmeleri de var, tünel açıklaması yok", async () => {
    openDealer("ERISIM");
    expect(await screen.findByRole("button", { name: "Anahtar bağla" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tavanı değiştir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pasife al" })).toBeInTheDocument();
    expect(screen.queryByText(/Anahtar kaydı güven kökü ekler|portal-baglan/)).toBeNull();
  });

  it("GENEL: sürümlerde 'Anahtar kaydet' var (pozitif kontrol)", async () => {
    openReleases("GENEL");
    expect(await screen.findByRole("button", { name: "Anahtar kaydet" })).toBeInTheDocument();
  });

  it("ERISIM: sürümlerde 'Anahtar kaydet' VAR, yayıncıyı pasife alma da var, tünel açıklaması yok", async () => {
    openReleases("ERISIM");
    expect(await screen.findByRole("button", { name: "Anahtar kaydet" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pasife al" })).toBeInTheDocument();
    expect(screen.queryByText(/Anahtar kaydı güven kökü ekler|portal-baglan/)).toBeNull();
  });
});
