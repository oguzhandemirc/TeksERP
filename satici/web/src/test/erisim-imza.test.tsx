// İNTERNET PORTALI (ERİŞİM, Cloudflare Access arkası) — lisans imzası dinleyiciden bağımsız AYNI çalışır (kullanıcı kararı
// 2026-10-04): ERISIM oturumunda "Lisansı yenile" düğmesi var, form planın istediği parolayı (ara imzacı / kök) sorar ve
// gövde `imzaci` + `imzaParolasi` ile /surum'a gider; "bu bağlantıdan yapılamaz" açıklaması YOK. Pozitif kontrol: aynı
// akış GENEL oturumunda da koşar (kör "her şey kapalı" ile kör "her şey açık" ayrılır).
// NEGATİF SONDA (2026-10-04, dosya DIŞI, shasum ile geri alındı): EntitlementPanel'de imza düğmesi ERISIM'de gizlendi
// (eski `signingBlocked` kilidinin eşdeğeri) → ERISIM ARA ve ERISIM KOK testleri ❌, GENEL yeşil; panel her dinleyicide
// kapatılınca (`closed = true`) üç test de ❌ (GENEL pozitif kontrolü kör-açma/kör-kapama ayrımını taşır).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import type { SigningPlan } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes } from "./harness";

const HAK_ID = "5b0c6a4e-2222-4000-8000-000000000002";
const ARA: SigningPlan = { imzaci: "ARA", kid: "ara-2026-1", neden: null, bekleyenTalep: null };
const KOK: SigningPlan = { imzaci: "KOK", kid: "hazirlik-2026-1", neden: null, bekleyenTalep: null };

function openInstallation(dinleyici: SessionListener, plan: SigningPlan = ARA) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_YONETICI"), dinleyici } }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      [`GET /haklar/${HAK_ID}/imza-plani`]: () => ({ data: plan }),
      [`POST /haklar/${HAK_ID}/surum`]: () => ({ status: 201, data: { id: "v", hakId: HAK_ID, surum: 2, imzalayanKid: plan.kid, uzunUfuk: false } }),
    },
  });
}

async function sign(user: ReturnType<typeof userEvent.setup>, passwordLabel: RegExp, password: string) {
  await user.click(await screen.findByRole("button", { name: "Lisansı yenile" }));
  const dialog = await screen.findByRole("dialog", { name: /Lisansı yenile/ });
  await within(dialog).findAllByRole("note");
  await user.type(within(dialog).getByLabelText(/^Sebep/), "bakım uzatma");
  await user.type(within(dialog).getByLabelText(passwordLabel), password);
  await user.click(within(dialog).getByRole("button", { name: "İmzala" }));
}

describe("internet portalında lisans imzası açık", () => {
  it("GENEL: yönetici 'Lisansı yenile' düğmesini görür, ara imzacı parolasıyla /surum çağrılır (pozitif kontrol)", async () => {
    const user = userEvent.setup();
    const { calls } = openInstallation("GENEL");
    await sign(user, /^Ara imzacı parolası/, "ara-parola");
    expect(writes(calls)[0]!.body).toMatchObject({ imzaci: "ARA", imzaParolasi: "ara-parola" });
    expect(screen.queryByText(/Cloudflare'den geçmez/)).toBeNull();
  });

  it("ERISIM + ARA planı: düğme ve parola alanı var, açıklama yok; gövde `imzaci: ARA` + `imzaParolasi` ile /surum çağrılır", async () => {
    const user = userEvent.setup();
    const { calls } = openInstallation("ERISIM", ARA);
    expect(await screen.findByRole("button", { name: "Lisansı yenile" })).toBeInTheDocument();
    expect(screen.queryByText(/Cloudflare'den geçmez|portal-baglan/)).toBeNull();
    await sign(user, /^Ara imzacı parolası/, "ara-parola");
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/haklar/${HAK_ID}/surum`);
    expect(w[0]!.body).toMatchObject({ imzaci: "ARA", imzaParolasi: "ara-parola", sebep: "bakım uzatma" });
    expect(w[0]!.body).not.toHaveProperty("kokParolasi");
  });

  it("ERISIM + KÖK planı: kök anahtar parolası da internetten yazılır (kullanıcı kararı); gövde `imzaci: KOK`", async () => {
    const user = userEvent.setup();
    const { calls } = openInstallation("ERISIM", KOK);
    await sign(user, /^Kök anahtar parolası/, "kok-parola");
    expect(writes(calls)[0]!.body).toMatchObject({ imzaci: "KOK", imzaParolasi: "kok-parola" });
  });
});
