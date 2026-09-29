// PATRON BULUTU KURULUM AYARLARI (3bc) — kurulum ayrıntısı eşitleme aralığını ve buluttaki geçmişi gösterir;
// düzenleme penceresi iki alanı sunucunun sözleşmesiyle gönderir (aralık sayı, "Tüm geçmiş" = null).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { retentionBody, retentionValue } from "../shared/cloud-settings";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes } from "./harness";

function openDetail() {
  const detail = installationDetail();
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      [`PATCH /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
    },
  });
}

describe("patron bulutu kurulum ayarları", () => {
  it("saklama seçimi sözleşmeye çevrilir (tüm geçmiş = null)", () => {
    expect(retentionBody(retentionValue(null))).toBeNull();
    expect(retentionBody(retentionValue(25))).toBe(25);
  });

  it("ayrıntı iki ayarı gösterir, düzenleme gövdeye yazar", async () => {
    const user = userEvent.setup();
    const { calls } = openDetail();
    expect(await screen.findByText("Bulut eşitleme aralığı")).toBeInTheDocument();
    expect(screen.getByText("5 dk")).toBeInTheDocument();
    expect(screen.getByText("13 ay")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Düzenle" }));
    const dialog = await screen.findByRole("dialog");
    const sync = within(dialog).getByLabelText(/eşitleme aralığı/i);
    await user.clear(sync);
    await user.type(sync, "10");
    await user.selectOptions(within(dialog).getByLabelText(/Buluttaki geçmiş/), "Tüm geçmiş");
    await user.click(within(dialog).getByRole("button", { name: "Kaydet" }));

    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}`);
    expect(w[0]!.body).toMatchObject({ esitlemeAraligiDk: 10, bulutSaklamaAy: null, yoklamaAraligiDk: 60 });
  });
});
