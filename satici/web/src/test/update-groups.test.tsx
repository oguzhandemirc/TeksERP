// GÜNCELLEME GRUBU (tek ortak paket O2, arayüz yarısı; karar sunucuda, bekçi `satici/sunucu/scripts/test_guncelleme_grubu.ts`).
// Grup portaldan AÇILMAZ (açma formu yok, yalnız ad · sıra · sürümler düzenlenir); kurulum formu yalnız AKTİF grupları sunar,
// boş seçim gövdeye kanalKodu koymaz (sunucu sınıftan seçer, K-3); düzenlemede grup yalnız değişince gider ve "geri sürüm yok"
// uyarısı görünür; emekli kanaldaki kurulumun grubu seçili görünür ama yeni seçenek olarak sunulmaz.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { Channel, InstallationDetail } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes } from "./harness";

const SITE_ID = "5b0c6a4e-3333-4000-8000-000000000003";

function channel(kod: string, sira: number | null, aktif: boolean, id: string): Channel {
  return { id, kod, ad: kod, tur: "uretim", guncelSurumler: { panel: "1.2.3" }, sira, aktif, kurulumSayisi: 0, createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z" };
}

const CHANNELS: Channel[] = [
  channel("test", 1, true, "6b0c6a4e-0001-4000-8000-000000000001"),
  channel("oncu", 2, true, "6b0c6a4e-0002-4000-8000-000000000002"),
  channel("genel", 3, true, "6b0c6a4e-0003-4000-8000-000000000003"),
  channel("demofabrika", null, false, "6b0c6a4e-0004-4000-8000-000000000004"),
];

function open(path: string, d: InstallationDetail = installationDetail()) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      "GET /kanallar": () => ({ data: CHANNELS }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kurulumlar": () => ({ data: { items: [], nextCursor: null } }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: d }),
      [`PATCH /kanallar/${CHANNELS[1]!.id}`]: () => ({ data: CHANNELS[1] }),
      // Başarılı doğuş ayrıntıya gezinir (jsdom veri yönlendiricisinde Request kurulamaz); bu test yalnız gövdeyi ölçer.
      "POST /kurulumlar": () => ({ status: 400, code: "GOVDE_GECERSIZ", message: "ölçüm" }),
      [`PATCH /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: d.kurulum }),
    },
  });
}

function withGroup(kanalKodu: string): InstallationDetail {
  const d = installationDetail();
  return { ...d, kurulum: { ...d.kurulum, kanalKodu } };
}

describe("güncelleme grupları ekranı", () => {
  it("grup açma düğmesi yok; emekli kanal rozetli; düzenleme ad · sıra · sürümleri PATCH eder (kod/tür yok)", async () => {
    const user = userEvent.setup();
    const { calls } = open("/kanallar");
    await screen.findByText("Emekli");
    expect(screen.queryByRole("button", { name: /Yeni kanal|Yeni grup/ })).toBeNull();
    expect(screen.getByText("Emekli")).toBeInTheDocument();
    expect(screen.getAllByText("Aktif")).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Düzenle" })[1]!);
    const dialog = await screen.findByRole("dialog", { name: /Güncelleme grubu: Öncü \(oncu\)/ });
    const order = within(dialog).getByLabelText(/^Sıra/);
    await user.clear(order);
    await user.type(order, "100");
    expect(within(dialog).getByRole("button", { name: "Kaydet" })).toBeDisabled();
    await user.clear(order);
    await user.type(order, "2");
    await user.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.method).toBe("PATCH");
    expect(w[0]!.path).toBe(`/kanallar/${CHANNELS[1]!.id}`);
    expect(w[0]!.body).toMatchObject({ ad: "oncu", sira: 2, guncelSurumler: { panel: "1.2.3" } });
    expect(w[0]!.body).not.toHaveProperty("kod");
    expect(w[0]!.body).not.toHaveProperty("tur");
  });
});

describe("kurulum formu — güncelleme grubu", () => {
  it("yeni kurulum: yalnız aktif gruplar; boş = sınıftan (K-3), gövdede kanalKodu yok", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/kurulumlar?tesisId=${SITE_ID}&yeni=1`);
    const dialog = await screen.findByRole("dialog", { name: "Yeni kurulum" });
    const group = within(dialog).getByLabelText(/^Güncelleme grubu/);
    await within(dialog).findByRole("option", { name: "Öncü (oncu)" });
    const options = within(group).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Sınıftan: Genel (genel)", "Test (test)", "Öncü (oncu)", "Genel (genel)"]);
    await user.selectOptions(within(dialog).getByLabelText(/^Lisans sınıfı/), "TEST");
    expect(within(group).getAllByRole("option")[0]!.textContent).toBe("Sınıftan: Test (test)");
    await user.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("/kurulumlar");
    expect(w[0]!.body).toMatchObject({ tesisId: SITE_ID, sinif: "TEST" });
    expect(w[0]!.body).not.toHaveProperty("kanalKodu");
  });

  it("düzenleme: grup değişmezse gövdede kanalKodu yok; değişince uyarı + kanalKodu", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/kurulumlar/${INSTALLATION_DB_ID}`, withGroup("genel"));
    await user.click(await screen.findByRole("button", { name: "Düzenle" }));
    const dialog = await screen.findByRole("dialog", { name: "Kurulumu düzenle" });
    expect(within(dialog).queryByText(/Geri sürüm yok/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(writes(calls)[0]!.body).not.toHaveProperty("kanalKodu");

    await user.click(await screen.findByRole("button", { name: "Düzenle" }));
    const again = await screen.findByRole("dialog", { name: "Kurulumu düzenle" });
    await user.selectOptions(within(again).getByLabelText(/^Güncelleme grubu/), "oncu");
    expect(within(again).getByText(/Geri sürüm yok/)).toBeInTheDocument();
    await user.click(within(again).getByRole("button", { name: "Kaydet" }));
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[1]!.body).toMatchObject({ kanalKodu: "oncu" });
  });

  it("emekli kanaldaki kurulum: bugünkü kanal seçili ve işaretli, diğer emekli kanal sunulmaz, boş seçenek yok", async () => {
    const user = userEvent.setup();
    open(`/kurulumlar/${INSTALLATION_DB_ID}`, withGroup("demofabrika"));
    await user.click(await screen.findByRole("button", { name: "Düzenle" }));
    const dialog = await screen.findByRole("dialog", { name: "Kurulumu düzenle" });
    const group = within(dialog).getByLabelText(/^Güncelleme grubu/) as HTMLSelectElement;
    expect(group.value).toBe("demofabrika");
    const options = within(group).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["demofabrika — emekli kanal", "Test (test)", "Öncü (oncu)", "Genel (genel)"]);
  });
});
