// K8 — bakım bitişi fabrikada kurulu sürümün derlemesinden ÖNCEYE alınırken imzadan önce uyarı. Karar fabrikada
// (derleme > bakım bitişi → ek süre); portal yalnız ön uyarı verir, imzayı engellemez.
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { installedBuildOf, maintenanceBeforeBuild } from "../portal/installation/EntitlementSigning";
import { PORTAL_ROUTES } from "../portal/routes";
import type { InstallationDetail } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor } from "./harness";

const HAK_ID = "5b0c6a4e-2222-4000-8000-000000000002";
const BUILD = "2027-10-15T09:00:00.000Z";
const TEST_ID = "bakim-kurulu-surumden-once";

function detail(sonOrtam: Record<string, unknown> | null): InstallationDetail {
  const d = installationDetail();
  return { ...d, kurulum: { ...d.kurulum, sonOrtam } };
}

async function open(user: ReturnType<typeof userEvent.setup>, sonOrtam: Record<string, unknown> | null) {
  renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail(sonOrtam) }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      [`GET /haklar/${HAK_ID}/imza-plani`]: () => ({ data: { imzaci: "ARA", kid: "ara-2026-1", neden: null, bekleyenTalep: null } }),
    },
  });
  await user.click(await screen.findByRole("button", { name: "Lisansı yenile" }));
  const dialog = await screen.findByRole("dialog", { name: /Lisansı yenile/ });
  await within(dialog).findAllByRole("note");
  return dialog;
}

const setMaintenance = (dialog: HTMLElement, value: string) => fireEvent.change(within(dialog).getByLabelText(/^Bakım bitişi/), { target: { value } });

describe("saf yardımcılar", () => {
  it("derleme bakım bitişinden SONRAysa true; eşit/önceyse ya da bilinmiyorsa false", () => {
    expect(maintenanceBeforeBuild("2027-10-01T00:00:00.000Z", BUILD)).toBe(true);
    expect(maintenanceBeforeBuild(BUILD, BUILD)).toBe(false);
    expect(maintenanceBeforeBuild("2027-11-01T00:00:00.000Z", BUILD)).toBe(false);
    expect(maintenanceBeforeBuild(undefined, BUILD)).toBe(false);
    expect(maintenanceBeforeBuild("2027-10-01T00:00:00.000Z", null)).toBe(false);
  });

  it("derleme tarihi yalnız geçerli ISO metinden okunur", () => {
    expect(installedBuildOf({ derlemeTarihi: BUILD })).toBe(BUILD);
    expect(installedBuildOf({ derlemeTarihi: "yarın" })).toBeNull();
    expect(installedBuildOf({ derlemeTarihi: 5 })).toBeNull();
    expect(installedBuildOf(null)).toBeNull();
  });
});

describe("lisans yenileme formu — bakım kurulu sürümden önceye düşerse", () => {
  it("⭐ bakım bitişi derlemeden önceye alınınca imzadan ÖNCE uyarı çıkar; imza düğmesi kapanmaz", async () => {
    const user = userEvent.setup();
    const dialog = await open(user, { derlemeTarihi: BUILD });
    expect(within(dialog).queryByTestId(TEST_ID)).toBeNull();
    setMaintenance(dialog, "2027-10-01");
    const warn = await within(dialog).findByTestId(TEST_ID);
    expect(warn.textContent).toContain("bakım sonrası çıkmış sürüm");
    expect(warn.textContent).toContain("Müşteri bunu kendisi düzeltemez");
  });

  it("negatif sonda: bakım bitişi derlemeden sonraya alınırsa uyarı yok", async () => {
    const user = userEvent.setup();
    const dialog = await open(user, { derlemeTarihi: BUILD });
    setMaintenance(dialog, "2027-11-01");
    expect(within(dialog).queryByTestId(TEST_ID)).toBeNull();
  });

  it("negatif sonda: bakım bitişine dokunulmadıysa (mevcut değer derlemeden önce olsa da) uyarı yok", async () => {
    const user = userEvent.setup();
    const dialog = await open(user, { derlemeTarihi: BUILD });
    setMaintenance(dialog, "2027-09-29");
    expect(within(dialog).queryByTestId(TEST_ID)).toBeNull();
  });

  it("negatif sonda: kurulu sürüm bilinmiyorsa (son yoklama yok) uyarı yok", async () => {
    const user = userEvent.setup();
    const dialog = await open(user, null);
    setMaintenance(dialog, "2027-10-01");
    expect(within(dialog).queryByTestId(TEST_ID)).toBeNull();
  });
});
