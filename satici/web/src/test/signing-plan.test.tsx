// HAK İMZA PLANI + SÜRÜM FORMU — bileşen bekçisi (lisans v2 · G4 · K2). Plan sunucudan gelir ve panelde nedeniyle görünür;
// form plana göre parola sorar (ara imzacı / kök) ya da sormaz (kök kuyruğu) ve planı `imzaci` olarak beyan eder (eski
// `kokParolasi` alanı gitmez). Plan arada değiştiyse (kök VDS'ten kalktı) sunucu 409 der: form yeni planı çeker, açık TR
// açıklamayla yönlendirir, parolayı siler. Ufuk: 400'ü aşan/süresiz yalnız yöneticiye ve lisans numarası yazılarak;
// DEMO/TEST ≤ 45. Kuyruk yanıtı (202) kuyruk ekranına yönlendirir.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PLAN_CHANGED_TEXT } from "../portal/installation/EntitlementSigning";
import { PORTAL_ROUTES } from "../portal/routes";
import type { PortalRole } from "../shared/permissions";
import type { InstallationDetail, SigningPlan } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, LICENSE_NO, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const HAK_ID = "5b0c6a4e-2222-4000-8000-000000000002";
const ARA: SigningPlan = { imzaci: "ARA", kid: "ara-2026-1", neden: null, bekleyenTalep: null };
const KOK: SigningPlan = { imzaci: "KOK", kid: "hazirlik-2026-1", neden: null, bekleyenTalep: null };
const KUYRUK: SigningPlan = { imzaci: "KUYRUK", kid: null, neden: "YETENEK_YOK", bekleyenTalep: null };

function detail(over: { sinif?: string; ufuk?: number | null } = {}): InstallationDetail {
  const d = installationDetail();
  const hak = { ...d.hak!, cevrimdisiUfukGun: over.ufuk === undefined ? 400 : over.ufuk, cevrimdisiUfukSuresiz: over.ufuk === null, kipAltSiniriZorla: false };
  return { ...d, kurulum: { ...d.kurulum, sinif: over.sinif ?? "URETIM" }, hak };
}

/** `plans`: sunucunun planı; `surum` yanıtı planı değiştirebilir (kök VDS'ten kalktı — sonraki okuma yeni planı görür). */
function open(g: { role?: PortalRole; plans: SigningPlan[]; detail?: InstallationDetail; surum?: Handler; planAfterPost?: SigningPlan }) {
  let plan = g.plans[0]!;
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(g.role ?? "SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: g.detail ?? detail() }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      [`GET /haklar/${HAK_ID}/imza-plani`]: () => ({ data: plan }),
      [`POST /haklar/${HAK_ID}/surum`]: (req, calls) => {
        if (g.planAfterPost) plan = g.planAfterPost;
        return (g.surum ?? (() => ({ status: 201, data: { id: "v", hakId: HAK_ID, surum: 2, imzalayanKid: "ara-2026-1", uzunUfuk: false } })))(req, calls);
      },
    },
  });
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Lisansı yenile" }));
  const dialog = await screen.findByRole("dialog", { name: /Lisansı yenile/ });
  await within(dialog).findAllByRole("note");
  return dialog;
}

describe("imza planı paneli", () => {
  it("planı nedeniyle gösterir (ara imzacı) ve HAK'ın çevrimdışı ufkunu", async () => {
    open({ plans: [ARA] });
    expect(await screen.findByText(/İmza planı: Ara imzacı \(ara-2026-1\) — kurulum ara imzalı HAK'ı tanıyor/)).toBeInTheDocument();
    expect(screen.getByText("400 gün")).toBeInTheDocument();
  });

  it("kök kuyruğu planı nedenini ve bekleyen talebi gösterir; formda gönderim kapalı", async () => {
    const user = userEvent.setup();
    open({ plans: [{ ...KUYRUK, bekleyenTalep: "7a000000-0000-4000-8000-000000000001" }] });
    expect(await screen.findByText(/Kök imzası kuyruğu — kurulumun derlemesi ara imzalı HAK'ı tanımıyor/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Kök imzası kuyruğu" }).length).toBeGreaterThan(0);
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText(/^Sebep/), "bakım uzatma");
    expect(within(dialog).getByRole("button", { name: "Kök kuyruğuna gönder" })).toBeDisabled();
  });
});

describe("plana göre sürüm formu", () => {
  it("⭐ ara imzacı: 'Ara imzacı parolası' sorulur; gövde `imzaci: ARA` + `imzaParolasi`, eski `kokParolasi` YOK", async () => {
    const user = userEvent.setup();
    const { calls } = open({ plans: [ARA] });
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText(/^Sebep/), "bakım uzatma");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası/), "ara-parola");
    await user.click(within(dialog).getByRole("button", { name: "İmzala" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.body).toMatchObject({ imzaci: "ARA", imzaParolasi: "ara-parola", sebep: "bakım uzatma" });
    expect(w[0]!.body).not.toHaveProperty("kokParolasi");
    expect(w[0]!.body).not.toHaveProperty("cevrimdisiUfukGun");
  });

  it("⭐ kök kuyruğu: parola alanı YOK, gövde parolasız; 202 yanıtı kuyruk ekranına yönlendirir", async () => {
    const user = userEvent.setup();
    const { calls } = open({ plans: [KUYRUK], surum: () => ({ status: 202, data: { kuyruk: true, talepId: "t1", hakId: HAK_ID, surum: 2, durum: "BEKLIYOR" } }) });
    const dialog = await openForm(user);
    expect(within(dialog).queryByLabelText(/parolası/)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "modül çıkarıldı");
    await user.click(within(dialog).getByRole("button", { name: "Kök kuyruğuna gönder" }));
    expect(writes(calls)[0]!.body).toMatchObject({ imzaci: "KUYRUK", sebep: "modül çıkarıldı" });
    expect(writes(calls)[0]!.body).not.toHaveProperty("imzaParolasi");
    const done = await screen.findByRole("dialog", { name: "Kök imzası kuyruğuna girdi" });
    expect(within(done).getByRole("link", { name: "Kök imzası kuyruğuna git" })).toHaveAttribute("href", "/kok-kuyrugu");
  });

  it("⭐ plan değişti (kök VDS'ten kalktı): 409 → yeni plan çekilir, açık açıklama, parola silinir, alan ara imzacıya döner", async () => {
    const user = userEvent.setup();
    const { calls } = open({
      plans: [KOK],
      planAfterPost: ARA,
      surum: () => ({ status: 409, code: "DURUM_CAKISMASI", message: "İmza planı değişti", details: { imzaci: "ARA" } }),
    });
    const dialog = await openForm(user);
    await user.type(within(dialog).getByLabelText(/^Sebep/), "yenileme");
    await user.type(within(dialog).getByLabelText(/^Kök anahtar parolası/), "kok-parola");
    await user.click(within(dialog).getByRole("button", { name: "İmzala" }));
    expect(await within(dialog).findByText(PLAN_CHANGED_TEXT.ARA)).toBeInTheDocument();
    const field = await within(dialog).findByLabelText(/^Ara imzacı parolası/);
    expect(field).toHaveValue("");
    expect(writes(calls)[0]!.body).toMatchObject({ imzaci: "KOK", imzaParolasi: "kok-parola" });
    expect(calls.filter((c) => c.path.endsWith("/imza-plani")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("çevrimdışı ufuk (K2)", () => {
  it("operatör 400 günü aşamaz: açıklama + gönderim kapalı", async () => {
    const user = userEvent.setup();
    open({ role: "SATICI_OPERATOR", plans: [ARA] });
    const dialog = await openForm(user);
    await user.click(within(dialog).getByLabelText(/Çevrimdışı ufku değiştir/));
    const days = within(dialog).getByLabelText(/^Çevrimdışı ufuk \(gün\)/);
    await user.clear(days);
    await user.type(days, "500");
    expect(within(dialog).getByText("400 günü aşan ya da süresiz ufuk yalnız yöneticinin işidir.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Süresiz ufuk/)).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "ufuk");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası/), "p");
    expect(within(dialog).getByRole("button", { name: "İmzala" })).toBeDisabled();
  });

  it("⭐ yönetici uzun ufuk: lisans numarası AYNEN yazılmadan gönderilmez; gövde ufuk + onay taşır; süresiz → null", async () => {
    const user = userEvent.setup();
    const { calls } = open({ plans: [ARA] });
    const dialog = await openForm(user);
    await user.click(within(dialog).getByLabelText(/Çevrimdışı ufku değiştir/));
    const days = within(dialog).getByLabelText(/^Çevrimdışı ufuk \(gün\)/);
    await user.clear(days);
    await user.type(days, "730");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "uzun ufuk");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası/), "p");
    const sign = within(dialog).getByRole("button", { name: "İmzala" });
    expect(sign).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Lisans numarası \(uzun ufuk/), LICENSE_NO);
    await user.click(within(dialog).getByLabelText(/Süresiz ufuk/));
    expect(sign).toBeEnabled();
    await user.click(sign);
    expect(writes(calls)[0]!.body).toMatchObject({ cevrimdisiUfukGun: null, onay: LICENSE_NO });
  });

  it("kayıtlı uzun ufkun aynısı ikinci onay istemez", async () => {
    const user = userEvent.setup();
    open({ plans: [ARA], detail: detail({ ufuk: 730 }) });
    const dialog = await openForm(user);
    await user.click(within(dialog).getByLabelText(/Çevrimdışı ufku değiştir/));
    expect(within(dialog).getByLabelText(/^Çevrimdışı ufuk \(gün\)/)).toHaveValue(730);
    expect(within(dialog).queryByLabelText(/Lisans numarası \(uzun ufuk/)).toBeNull();
  });

  it("DEMO sınıfında tavan 45 gün", async () => {
    const user = userEvent.setup();
    open({ plans: [ARA], detail: detail({ sinif: "DEMO", ufuk: 45 }) });
    const dialog = await openForm(user);
    await user.click(within(dialog).getByLabelText(/Çevrimdışı ufku değiştir/));
    expect(within(dialog).getByText("Bu sınıfta en çok 45 gün.")).toBeInTheDocument();
    const days = within(dialog).getByLabelText(/^Çevrimdışı ufuk \(gün\)/);
    await user.clear(days);
    await user.type(days, "60");
    expect(within(dialog).getByText("Çevrimdışı ufuk 1–45 gün olmalı.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Süresiz ufuk/)).toBeNull();
  });
});
