// K10 — kurulum ayrıntısında fabrikanın bildirdiği AÇIK modül adları; bildirmeyen (eski) fabrika "bilinmiyor" gösterir.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { InstallationDetail } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor } from "./harness";

function detail(ek: { acikModuller?: readonly string[] | null; acikModullerZamani?: string | null }): InstallationDetail {
  const d = installationDetail();
  return { ...d, kurulum: { ...d.kurulum, ...ek } };
}

async function open(ek: Parameters<typeof detail>[0]) {
  const user = userEvent.setup();
  renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail(ek) }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
    },
  });
  await user.click(await screen.findByRole("tab", { name: "Sağlık ve kira" }));
}

describe("açık modüller (K10)", () => {
  it("⭐ bildirilen açık modül adları kurulum ekranında listelenir", async () => {
    await open({ acikModuller: ["finance.enabled", "production.enabled"], acikModullerZamani: "2026-10-06T09:00:00.000Z" });
    expect(await screen.findByText("finance.enabled")).toBeInTheDocument();
    expect(screen.getByText("production.enabled")).toBeInTheDocument();
    expect(screen.queryByTestId("acik-moduller-bilinmiyor")).toBeNull();
  });

  it("karşı: fabrika bildirmediyse (null / alan yok) 'Bilinmiyor' yazar, liste çizilmez", async () => {
    await open({ acikModuller: null });
    expect(await screen.findByTestId("acik-moduller-bilinmiyor")).toHaveTextContent("Bilinmiyor");
    expect(screen.queryByText("finance.enabled")).toBeNull();
  });

  it("boş liste 'Hiçbiri açık değil' der (bilinmiyor değil)", async () => {
    await open({ acikModuller: [], acikModullerZamani: "2026-10-06T09:00:00.000Z" });
    expect(await screen.findByText("Hiçbiri açık değil")).toBeInTheDocument();
    expect(screen.queryByTestId("acik-moduller-bilinmiyor")).toBeNull();
  });
});
