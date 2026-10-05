// SİSTEM SAĞLIĞI KARTI (pano) — GET /saglik yanıtındaki sayı ve durumlar kartta görünür; yükleniyor ve hata hali ayrı.
// NEGATİF SONDA (dosya DIŞI, geri alındı): SystemHealthCard'da JWKS yaş durumu satırı kaldırıldı → "Tavanı aştı" testi ❌;
// zil abone sayısı satırı kaldırıldı → zil testi ❌.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SystemHealth } from "../shared/types";
import { renderApp, sessionFor, type Handler } from "./harness";

const DASHBOARD = { kurulumlar: { ETKIN: 2 }, acikKopyaUyarisi: 0, bekleyenTasima: 0, gecikenTaksit: 0, yediGundePlanliEylem: 0, yirmiDortSaattirSessiz: 0 };

const HEALTH: SystemHealth = {
  zil: { dinliyor: true, abone: 7, teslim: 1234 },
  anahtarlar: { capa: "dosya", altGecerli: 3, indirmeVar: true, uyariSayisi: 2 },
  denetimYazmaHatasi: 4,
  erisim: { kip: "acik", jwks: { dolu: true, anahtarSayisi: 2, dosyaYasiSn: 5 * 86400, azamiYasSn: 7 * 86400, yasDurumu: "UYARI", okumaYasiSn: 60, sonHata: null } },
};

function open(saglik: Handler) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    handlers: { "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }), "GET /pano": () => ({ data: DASHBOARD }), "GET /saglik": saglik },
  });
}

async function card() {
  return (await screen.findByText("Sistem sağlığı")).closest("section")!;
}

describe("pano — sistem sağlığı kartı", () => {
  it("anahtar, zil, denetim ve ERİŞİM jwks alanlarını sayı/durum olarak gösterir", async () => {
    open(() => ({ data: HEALTH }));
    const c = await card();
    expect(await within(c).findByText("Dosyadan")).toBeInTheDocument();
    const keys = within(c).getByText("Anahtarlar").closest(".card") as HTMLElement;
    expect(within(keys).getByText("Geçerli alt sertifika").nextSibling).toHaveTextContent("3");
    expect(within(keys).getByText("İndirme anahtarı").nextSibling).toHaveTextContent("Var");
    expect(within(keys).getByText("Anahtar uyarısı").nextSibling).toHaveTextContent("2");
    const zil = within(c).getByText("Bildirim zili").closest(".card") as HTMLElement;
    expect(within(zil).getByText("Abone").nextSibling).toHaveTextContent("7");
    expect(within(zil).getByText("Teslim edilen").nextSibling).toHaveTextContent("1234");
    const audit = within(c).getByText("Denetim kaydı").closest(".card") as HTMLElement;
    expect(within(audit).getByText("Yazma hatası").nextSibling).toHaveTextContent("4");
    const access = within(c).getByText("İnternet portalı (Access)").closest(".card") as HTMLElement;
    expect(within(access).getByText("2 anahtar")).toBeInTheDocument();
    expect(within(access).getByText("5 gün 0 sa")).toBeInTheDocument();
    expect(within(access).getByText("Yaşlanıyor")).toBeInTheDocument();
  });

  it("ERİŞİM kapalıysa kart Kapalı der", async () => {
    open(() => ({ data: { ...HEALTH, erisim: { kip: "kapali" } } }));
    const c = await card();
    const access = (await within(c).findByText("İnternet portalı (Access)")).closest(".card") as HTMLElement;
    expect(within(access).getByText("Kapalı")).toBeInTheDocument();
  });

  it("jwks tavanı aştı ve okuma hatası ekranda", async () => {
    const jwks = { ...(HEALTH.erisim as Extract<SystemHealth["erisim"], { kip: "acik" }>).jwks, yasDurumu: "ASILDI" as const, sonHata: "dosya okunamadı" };
    open(() => ({ data: { ...HEALTH, erisim: { kip: "acik", jwks } } }));
    const c = await card();
    expect(await within(c).findByText(/Tavanı aştı/)).toBeInTheDocument();
    expect(within(c).getByText("dosya okunamadı")).toBeInTheDocument();
  });

  it("yükleniyor: yanıt gelene dek kart başlığı var, alanlar yok", async () => {
    open(() => new Promise(() => undefined));
    const c = await card();
    expect(within(c).queryByText("Anahtarlar")).toBeNull();
  });

  it("hata: sunucu iletisi kartta gösterilir", async () => {
    open(() => ({ status: 403, code: "YETKI_YOK", message: "Sağlık özeti alınamadı" }));
    const c = await card();
    expect(await within(c).findByText("Sağlık özeti alınamadı")).toBeInTheDocument();
  });
});
