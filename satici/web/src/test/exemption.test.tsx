// G2 MUAFİYET — kurulum künyesinin Lisans sekmesi: panel yalnız YÖNETİCİ'ye ve yalnız etkinleşmemiş kuruluma; plan
// sunucudan (ara imzacı / kök), gövde KATI alanlarla (zarf · sebep · imzacı · parola) gider, imzalı dosya AYNEN gösterilir.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { ExemptionResult } from "../portal/installation/ExemptionPanel";
import type { PortalRole } from "../shared/permissions";
import type { InstallationDetail } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const TITLE = "Etkinleştirme muafiyeti (eski kurulum)";

function unactivated(): InstallationDetail {
  const d = installationDetail();
  return { ...d, kurulum: { ...d.kurulum, durum: "ETKINLESMEDI" } };
}

function open(role: PortalRole, detail: InstallationDetail, extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/muafiyet-plani`]: () => ({ data: { imzaci: "ARA", kid: "ara-2026-1" } }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
}

describe("muafiyet paneli (G2)", () => {
  it("⭐ yönetici: karekod metni + sebep + ara imzacı parolası → imzalı dosya AYNEN", async () => {
    const user = userEvent.setup();
    const result: ExemptionResult = {
      muafiyetId: "5b0c6a4e-1111-4000-8000-000000000011",
      anahtarKimligi: "kur-abc",
      imzaci: "ARA",
      kid: "ara-2026-1",
      dosya: { v: 1, muafiyet: "m.e.s" },
      dosyaAdi: "muafiyet-TKS-2026-0042-20261012.json",
    };
    const { calls } = open("SATICI_YONETICI", unactivated(), { [`POST /kurulumlar/${INSTALLATION_DB_ID}/muafiyet`]: () => ({ status: 201, data: result }) });
    await user.click(await screen.findByRole("button", { name: "Muafiyet ver…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Karekod metni"), "  zarf-metni  ");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "eski kurulum");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası \(ara-2026-1\)/), "gizli");
    await user.click(within(dialog).getByRole("button", { name: "Muafiyeti imzala" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/muafiyet`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "imzaParolasi", "imzaci", "sebep", "zarf"]);
    expect(w[0]!.body).toMatchObject({ zarf: "zarf-metni", sebep: "eski kurulum", imzaci: "ARA", imzaParolasi: "gizli" });
    const ready = await screen.findByRole("dialog", { name: "Muafiyet dosyası hazır" });
    expect((within(ready).getByLabelText("Dosya içeriği") as HTMLTextAreaElement).value).toBe(JSON.stringify(result.dosya));
  });

  it("✓K operatör (yönetici değil) görmez", async () => {
    open("SATICI_OPERATOR", unactivated());
    await screen.findByRole("tab", { name: "Lisans" });
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("✓K etkin kurulumda panel yok", async () => {
    open("SATICI_YONETICI", installationDetail());
    await screen.findByRole("tab", { name: "Lisans" });
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("imzacı yoksa (KUYRUK) düğme yok, neden yazılır", async () => {
    open("SATICI_YONETICI", unactivated(), { [`GET /kurulumlar/${INSTALLATION_DB_ID}/muafiyet-plani`]: () => ({ data: { imzaci: "KUYRUK", kid: null } }) });
    expect(await screen.findByText(/ara imzacı ya da kök anahtarı bu sunucuda yok/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Muafiyet ver…" })).toBeNull();
  });
});
