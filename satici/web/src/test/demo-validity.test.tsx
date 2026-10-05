// K5 — DEMO LİSANSI BİTİŞSİZ KAYDEDİLMEZ (arayüz yarısı; karar sunucuda, bekçi `satici/sunucu/scripts/test_demo_bitis.ts`).
// Hak oluşturma formu DEMO'da geçerlilik bitişini ZORUNLU ister ve gövdeye `gecerlilikBitis` koyar; geçerlilik penceresi
// DEMO'da süre sınırını kaldırma seçeneği sunmaz; imza formu DEMO'da "kalıcıya çevir" sunmaz. URETIM'de üçü de eskisi gibi.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { InstallationDetail, SigningPlan } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes } from "./harness";

const HAK_ID = "5b0c6a4e-2222-4000-8000-000000000002";
const KOK: SigningPlan = { imzaci: "KOK", kid: "hazirlik-2026-1", neden: null, bekleyenTalep: null };

function detail(sinif: string, g: { noHak?: boolean; kalici?: boolean; gecerlilikBitis?: string | null } = {}): InstallationDetail {
  const d = installationDetail();
  const hak = g.noHak ? null : { ...d.hak!, kalici: g.kalici ?? false, gecerlilikBitis: g.gecerlilikBitis ?? null, cevrimdisiUfukGun: 45, cevrimdisiUfukSuresiz: false, kipAltSiniriZorla: false };
  return { ...d, kurulum: { ...d.kurulum, sinif, durum: g.noHak ? "ETKINLESMEDI" : d.kurulum.durum, haklar: hak ? [hak] : [] }, hak };
}

function open(d: InstallationDetail) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: d }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      [`GET /haklar/${HAK_ID}/imza-plani`]: () => ({ data: KOK }),
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/hak`]: () => ({ status: 201, data: { id: HAK_ID } }),
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/gecerlilik`]: () => ({ data: { degisti: true, eylem: null } }),
    },
  });
}

describe("hak oluşturma — geçerlilik bitişi", () => {
  it("DEMO: bitiş zorunlu; tarih girilmeden Oluştur kapalı, girilince gövdede gecerlilikBitis", async () => {
    const user = userEvent.setup();
    const { calls } = open(detail("DEMO", { noHak: true }));
    await user.click(await screen.findByRole("button", { name: "Lisans hakkı oluştur" }));
    const dialog = await screen.findByRole("dialog", { name: /Lisans hakkı oluştur/ });
    const create = within(dialog).getByRole("button", { name: "Oluştur" });
    const validity = within(dialog).getByLabelText(/^Geçerlilik bitişi \(zorunlu\)/);
    expect(create).toBeDisabled();
    await user.type(validity, "2026-11-15");
    expect(create).toBeEnabled();
    await user.click(create);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/hak`);
    expect(typeof (w[0]!.body as { gecerlilikBitis?: unknown }).gecerlilikBitis).toBe("string");
    expect((w[0]!.body as { gecerlilikBitis: string }).gecerlilikBitis.startsWith("2026-11-1")).toBe(true);
  });

  it("URETIM: bitiş alanı yok, gövdede gecerlilikBitis yok (bugünkü davranış)", async () => {
    const user = userEvent.setup();
    const { calls } = open(detail("URETIM", { noHak: true }));
    await user.click(await screen.findByRole("button", { name: "Lisans hakkı oluştur" }));
    const dialog = await screen.findByRole("dialog", { name: /Lisans hakkı oluştur/ });
    expect(within(dialog).queryByLabelText(/^Geçerlilik bitişi/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Oluştur" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.body).not.toHaveProperty("gecerlilikBitis");
  });
});

describe("geçerlilik penceresi — süre sınırını kaldırma", () => {
  async function openValidity(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("tab", { name: "Yaptırım" }));
    await user.click(await screen.findByRole("button", { name: "Geçerlilik bitişini ayarla" }));
    return screen.findByRole("dialog", { name: /Geçerlilik bitişi/ });
  }

  it("DEMO: kaldırma seçeneği yok; tarih + sebep olmadan Kaydet kapalı, gövdede tarih", async () => {
    const user = userEvent.setup();
    const { calls } = open(detail("DEMO", { gecerlilikBitis: "2026-11-01T00:00:00.000Z" }));
    const dialog = await openValidity(user);
    expect(within(dialog).queryByRole("checkbox", { name: /Süre sınırını kaldır/ })).toBeNull();
    const save = within(dialog).getByRole("button", { name: "Kaydet" });
    await user.type(within(dialog).getByLabelText(/^Sebep/), "demo uzadı");
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Bitiş tarihi/), "2026-11-20");
    expect(save).toBeEnabled();
    await user.click(save);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(typeof (w[0]!.body as { tarih?: unknown }).tarih).toBe("string");
  });

  it("URETIM: kaldırma seçeneği yerinde", async () => {
    const user = userEvent.setup();
    open(detail("URETIM", { gecerlilikBitis: "2026-11-01T00:00:00.000Z" }));
    const dialog = await openValidity(user);
    expect(within(dialog).getByRole("checkbox", { name: /Süre sınırını kaldır/ })).toBeInTheDocument();
  });
});

describe("imza formu — kalıcıya çevirme", () => {
  async function openSigning(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Lisansı yenile" }));
    const dialog = await screen.findByRole("dialog", { name: /Lisansı yenile/ });
    await within(dialog).findAllByRole("note");
    return dialog;
  }

  it("DEMO vadeli hak: 'Kalıcıya çevir' sunulmaz", async () => {
    const user = userEvent.setup();
    open(detail("DEMO", { gecerlilikBitis: "2026-11-01T00:00:00.000Z" }));
    const dialog = await openSigning(user);
    expect(within(dialog).queryByRole("checkbox", { name: /Kalıcıya çevir/ })).toBeNull();
  });

  it("URETIM vadeli hak: 'Kalıcıya çevir' yerinde", async () => {
    const user = userEvent.setup();
    open(detail("URETIM", { gecerlilikBitis: "2026-11-01T00:00:00.000Z" }));
    const dialog = await openSigning(user);
    expect(within(dialog).getByRole("checkbox", { name: /Kalıcıya çevir/ })).toBeInTheDocument();
  });
});
