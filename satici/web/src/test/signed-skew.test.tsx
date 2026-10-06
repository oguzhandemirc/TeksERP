// §B-3 — kurulum künyesinde fabrikanın bildirdiği İMZALI saat sapması; eşik aşılınca uyarı, bildirmeyen (eski) fabrika "Bildirilmedi".
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { InstallationDetail, PollRow } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor } from "./harness";

const POLL: PollRow = {
  id: "p1", sonuc: "BASARILI", kiraId: null, durum: { kip: "gozlem" }, gozlem: {},
  saat: { duvar: "2026-10-06T09:00:00.000Z", imzaliSapmaSn: 420 }, createdAt: "2026-10-06T09:00:00.000Z",
};

/** Sağlık özeti yalnız bir yoklama geldiyse çizilir. */
function withPoll(ek: Partial<Pick<InstallationDetail, "saatSapmasi" | "yoklamalar">>): InstallationDetail {
  const d = installationDetail();
  return { ...d, ...ek, kurulum: { ...d.kurulum, sonSaglik: { surum: "2.14.0" }, sonYoklamaZamani: "2026-10-06T09:00:00.000Z" } };
}

async function open(ek: Partial<Pick<InstallationDetail, "saatSapmasi" | "yoklamalar">>) {
  const user = userEvent.setup();
  renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: withPoll(ek) }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
    },
  });
  await user.click(await screen.findByRole("tab", { name: "Sağlık ve kira" }));
}

describe("imzalı saat sapması (§B-3)", () => {
  it("⭐ eşik aşılınca sapma ve uyarı görünür; yoklama geçmişinde kolon dolu", async () => {
    await open({ saatSapmasi: { sapmaSn: 420, uyari: true, esikSn: 300, an: "2026-10-06T09:00:00.000Z" }, yoklamalar: [POLL] });
    expect(await screen.findByText("Eşik 5 dk aşıldı — saat eşitlemesini denetleyin")).toBeInTheDocument();
    expect(screen.getAllByText(/7 dk ileride/).length).toBe(2);
    expect(screen.queryByTestId("imzali-saat-bilinmiyor")).toBeNull();
  });

  it("eşik altı: sapma yazılır, uyarı yok", async () => {
    await open({ saatSapmasi: { sapmaSn: -45, uyari: false, esikSn: 300, an: "2026-10-06T09:00:00.000Z" } });
    expect(await screen.findByText("45 sn geride")).toBeInTheDocument();
    expect(screen.queryByText(/aşıldı/)).toBeNull();
  });

  it("karşı: eski fabrika (alan yok) 'Bildirilmedi' der, uyarı çizilmez", async () => {
    await open({});
    expect(await screen.findByTestId("imzali-saat-bilinmiyor")).toHaveTextContent("Bildirilmedi");
    expect(screen.queryByText(/aşıldı/)).toBeNull();
  });
});
