// AĞIR YAPTIRIM İKİNCİ ONAYI — K4/K5 ağır uçtan (/agir-yaptirim), geri sayımı 7 günden kısa K3 kendi
// ucundan; üçü de yalnız yöneticinin ve lisans numarası AYNEN yazılmadan düğme açılmaz. 7 gün ve
// üstü K3 hafiftir (onay alanı yok, gövdede `onay` yok). Operatör ağır kademeyi hiç göremez.
// Geri alma: ağır satırı (K4/K5 ya da `agir` damgalı K3) operatör geri alamaz.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { HEAVY_K3_MIN_DAYS, isHeavyPlannedK3, isHeavySanctionInput, isHeavySanctionRow } from "../shared/sanctions";
import type { PortalRole } from "../shared/permissions";
import type { InstallationDetail } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, LICENSE_NO, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const DAY = 86_400_000;

function openSanctions(role: PortalRole, detail: InstallationDetail = installationDetail(), extra: Record<string, Handler> = {}) {
  const r = renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
  return r;
}

async function goToSanctionTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Yaptırım" }));
  return screen.getByRole("combobox", { name: "Kademe" });
}

describe("ağır yaptırım sınıfı (sunucu aynası)", () => {
  it("K4/K5 her zaman, K3 yalnız kısıtlama anı 7 günden yakınsa ağırdır", () => {
    const now = Date.parse("2026-09-29T10:00:00Z");
    expect(isHeavySanctionInput({ level: "K4" }, now)).toBe(true);
    expect(isHeavySanctionInput({ level: "K5" }, now)).toBe(true);
    expect(isHeavySanctionInput({ level: "K2" }, now)).toBe(false);
    expect(isHeavySanctionInput({ level: "K3", restrictionDays: 0 }, now)).toBe(true);
    expect(isHeavySanctionInput({ level: "K3", restrictionDays: HEAVY_K3_MIN_DAYS - 1 }, now)).toBe(true);
    expect(isHeavySanctionInput({ level: "K3", restrictionDays: HEAVY_K3_MIN_DAYS }, now)).toBe(false);
    expect(isHeavySanctionInput({ level: "K3", restrictionDate: new Date(now + 3 * DAY).toISOString() }, now)).toBe(true);
    expect(isHeavySanctionInput({ level: "K3", restrictionDate: new Date(now + 8 * DAY).toISOString() }, now)).toBe(false);
    expect(isHeavyPlannedK3("K3", 6)).toBe(true);
    expect(isHeavyPlannedK3("K3", 7)).toBe(false);
    expect(isHeavyPlannedK3("K2", 0)).toBe(false);
    expect(isHeavySanctionRow({ tur: "K3", parametre: { kisitlamaTarihi: "2026-09-30T00:00:00Z" } })).toBe(false);
    expect(isHeavySanctionRow({ tur: "K3", parametre: { agir: true } })).toBe(true);
    expect(isHeavySanctionRow({ tur: "K5", parametre: {} })).toBe(true);
  });
});

describe("yaptırım paneli — ikinci onay", () => {
  it("K4: sebep + lisans numarası AYNEN yazılmadan uygulanmaz; ağır uca onayla gider", async () => {
    const user = userEvent.setup();
    const { calls } = openSanctions("SATICI_YONETICI", installationDetail(), {
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/agir-yaptirim`]: () => ({ status: 201, data: { id: "x" } }),
    });
    await user.selectOptions(await goToSanctionTab(user), "K4");
    await user.click(screen.getByRole("button", { name: "Uygula…" }));
    const dialog = await screen.findByRole("dialog");
    const apply = within(dialog).getByRole("button", { name: "Uygula" });
    expect(within(dialog).getByText(/Örnek Tekstil › Ana tesis/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Ödeme yapılmadı");
    expect(apply).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Lisans numarası/), "TKS-2026-0041");
    expect(apply).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/^Lisans numarası/));
    await user.type(within(dialog).getByLabelText(/^Lisans numarası/), LICENSE_NO);
    expect(apply).toBeEnabled();
    await user.click(apply);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/agir-yaptirim`);
    expect(w[0]!.body).toMatchObject({ kademe: "K4", sebep: "Ödeme yapılmadı", onay: LICENSE_NO });
    expect(typeof w[0]!.body!.clientToken).toBe("string");
  });

  it("K5 de aynı ikinci onayı ister", async () => {
    const user = userEvent.setup();
    openSanctions("SATICI_YONETICI");
    await user.selectOptions(await goToSanctionTab(user), "K5");
    await user.click(screen.getByRole("button", { name: "Uygula…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Sözleşme ihlali");
    expect(within(dialog).getByRole("button", { name: "Uygula" })).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Lisans numarası/)).toBeInTheDocument();
  });

  it("7 günden kısa K3 ağırdır: kendi ucuna lisans numarasıyla gider; 7 gün hafiftir ve onaysız gider", async () => {
    const user = userEvent.setup();
    const { calls } = openSanctions("SATICI_YONETICI", installationDetail(), {
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/yaptirim`]: () => ({ status: 201, data: { id: "x" } }),
    });
    await user.selectOptions(await goToSanctionTab(user), "K3");
    await user.click(screen.getByRole("radio", { name: "Hemen" }));
    await user.click(screen.getByRole("button", { name: "Uygula…" }));
    let dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Vade geçti");
    expect(within(dialog).getByRole("button", { name: "Uygula" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Lisans numarası/), LICENSE_NO);
    await user.click(within(dialog).getByRole("button", { name: "Uygula" }));
    expect(writes(calls)[0]).toMatchObject({ path: `/kurulumlar/${INSTALLATION_DB_ID}/yaptirim`, body: { kademe: "K3", kisitlamaGun: 0, onay: LICENSE_NO } });

    await user.selectOptions(screen.getByRole("combobox", { name: "Kademe" }), "K3");
    await user.click(screen.getByRole("radio", { name: "7 gün" }));
    await user.click(screen.getByRole("button", { name: "Uygula…" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/^Lisans numarası/)).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Vade geçti");
    await user.click(within(dialog).getByRole("button", { name: "Uygula" }));
    const second = writes(calls)[1]!;
    expect(second.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/yaptirim`);
    expect(second.body).toMatchObject({ kademe: "K3", kisitlamaGun: 7 });
    expect(second.body).not.toHaveProperty("onay");
  });

  it("operatör K4/K5'i göremez, kısa K3'ü uygulayamaz", async () => {
    const user = userEvent.setup();
    openSanctions("SATICI_OPERATOR");
    const levels = await goToSanctionTab(user);
    const options = within(levels).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options).toEqual(["K0", "K1", "K2", "K3"]);
    await user.selectOptions(levels, "K3");
    await user.click(screen.getByRole("radio", { name: "Hemen" }));
    expect(screen.getByText(/ağır yaptırımdır: yalnız yönetici uygular/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uygula…" })).toBeDisabled();
  });

  it("ağır satırı operatör geri alamaz, hafif satırı geri alır", async () => {
    const user = userEvent.setup();
    const ledger = [
      { id: "a1", kurulumId: INSTALLATION_DB_ID, tur: "K4", parametre: {}, sebep: "ağır", yapan: "satici:y", geriAlinanEylemId: null, planliEylemId: null, createdAt: "2026-09-28T10:00:00Z" },
      { id: "a2", kurulumId: INSTALLATION_DB_ID, tur: "K3", parametre: { kisitlamaTarihi: "2026-09-29T10:00:00Z", agir: true }, sebep: "kısa", yapan: "satici:y", geriAlinanEylemId: null, planliEylemId: null, createdAt: "2026-09-28T11:00:00Z" },
      { id: "a3", kurulumId: INSTALLATION_DB_ID, tur: "K1", parametre: {}, sebep: "hafif", yapan: "satici:o", geriAlinanEylemId: null, planliEylemId: null, createdAt: "2026-09-28T12:00:00Z" },
    ];
    openSanctions("SATICI_OPERATOR", installationDetail({ yaptirimDefteri: ledger }));
    await goToSanctionTab(user);
    const rows = screen.getAllByRole("row");
    const rowOf = (reason: string) => rows.find((r) => within(r).queryByText(reason))!;
    expect(within(rowOf("ağır")).queryByRole("button", { name: "Geri al" })).toBeNull();
    expect(within(rowOf("kısa")).queryByRole("button", { name: "Geri al" })).toBeNull();
    expect(within(rowOf("hafif")).getByRole("button", { name: "Geri al" })).toBeInTheDocument();
  });
});
