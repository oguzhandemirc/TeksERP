// TAŞIMA TALEBİ İPTAL YÜZEYİ (B1k çıkışı) — bayi kendi kurulumunun bekleyen talebini sebeple reddeder (yalnız red;
// onay düğmesi yok), satıcı listesi hedef lisans kimliğiyle süzülür (uygulanınca gider, kimlik hücresinden de).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BAYI_ROUTES } from "../bayi/routes";
import { PORTAL_ROUTES } from "../portal/routes";
import type { DealerTransferRequest, TransferRequest } from "../shared/types";
import { INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const TALEP = "7d0c6a4e-2222-4000-8000-000000000071";
const HEDEF = "9e8d7c6b-0000-4000-8000-00000000abcd";

const dealerRow = (over: Partial<DealerTransferRequest> = {}): DealerTransferRequest => ({
  id: TALEP,
  bagli: false,
  yeniAnahtarKimligi: "kid-yabanci-01",
  ortam: { platform: "win32", isletimSistemi: "Windows 11", uygulamaSurum: "2.15.6" },
  gerekce: "sunucu değişti",
  durum: "BEKLIYOR",
  kararZamani: null,
  kararSebebi: null,
  createdAt: "2026-10-12T09:00:00.000Z",
  ...over,
});

function openDealer(rows: () => DealerTransferRequest[], extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/bayi/api",
    routes: BAYI_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("BAYI") }),
      "GET /ben": () => ({ data: { tavan: null, anahtarBagli: true } }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod-talepleri`]: () => ({ data: [] }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/tasima-talepleri`]: () => ({ data: rows() }),
      ...extra,
    },
  });
}

describe("bayi — taşıma talebi reddi", () => {
  it("⭐ bekleyen talep: yalnız Reddet (onay yok); onay penceresi kaydı adıyla gösterir, sebep zorunlu; gövde KATI; liste tazelenir", async () => {
    const user = userEvent.setup();
    let rows = [dealerRow()];
    const { calls } = openDealer(() => rows, {
      [`POST /tasima-talepleri/${TALEP}/reddet`]: () => {
        rows = [dealerRow({ durum: "REDDEDILDI", kararSebebi: "tanımadığımız makine" })];
        return { data: { id: TALEP, durum: "REDDEDILDI" } };
      },
    });
    const section = (await screen.findByRole("heading", { name: "Taşıma talepleri" })).closest("section")!;
    expect(await within(section).findByText("kid-yabanci-01")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Onayla" })).toBeNull();
    await user.click(within(section).getByRole("button", { name: "Reddet" }));
    const dialog = await screen.findByRole("dialog", { name: "Taşıma talebini reddet" });
    expect(within(dialog).getByText(/kid-yabanci-01/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Reddet" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "tanımadığımız makine");
    await user.click(confirm);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/tasima-talepleri/${TALEP}/reddet`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "sebep"]);
    expect(w[0]!.body).toMatchObject({ sebep: "tanımadığımız makine" });
    expect(await within(section).findByText("Reddedildi — tanımadığımız makine")).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Reddet" })).toBeNull();
  });

  it("✓K karara bağlanmış talepte düğme yok; 409 (başkası reddetti) pencerede hata olarak kalır", async () => {
    const user = userEvent.setup();
    openDealer(() => [dealerRow({ id: "7d0c6a4e-2222-4000-8000-000000000072", durum: "ONAYLANDI", yeniAnahtarKimligi: "kid-onayli" }), dealerRow()], {
      [`POST /tasima-talepleri/${TALEP}/reddet`]: () => ({ status: 409, code: "DURUM_CAKISMASI", message: "Taşıma talebi zaten karara bağlanmış" }),
    });
    const section = (await screen.findByRole("heading", { name: "Taşıma talepleri" })).closest("section")!;
    expect(await within(section).findByText("kid-onayli")).toBeInTheDocument();
    expect(within(section).getAllByRole("button", { name: "Reddet" })).toHaveLength(1);
    await user.click(within(section).getByRole("button", { name: "Reddet" }));
    const dialog = await screen.findByRole("dialog", { name: "Taşıma talebini reddet" });
    await user.type(within(dialog).getByRole("textbox"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Reddet" }));
    expect(await within(dialog).findByText(/zaten karara bağlanmış/)).toBeInTheDocument();
  });
});

describe("satıcı — taşıma talebi listesi hedef süzgeci", () => {
  const talep: TransferRequest = {
    id: TALEP,
    kurulumId: null,
    hedefKimlik: HEDEF,
    yeniAnahtarKimligi: "kid-yabanci-01",
    ortam: {},
    gerekce: null,
    durum: "BEKLIYOR",
    kararZamani: null,
    kararVeren: null,
    kararSebebi: null,
    createdAt: "2026-10-12T09:00:00.000Z",
    onerilenKurulumlar: [],
  };
  const other: TransferRequest = { ...talep, id: "7d0c6a4e-2222-4000-8000-000000000073", hedefKimlik: "9e8d7c6b-0000-4000-8000-00000000ffff", yeniAnahtarKimligi: "kid-baska-hedef" };

  it("⭐ süzgeç uygulanınca hedefKimlik sorguya gider; kimlik hücresi de süzer; kaldırınca sorgudan düşer", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: "/tasima-talepleri",
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
        // Süzgeçsiz liste başka hedefin talebini de taşır: süzgecin ekranda etkisi ölçülür (önbellek yeniden istemeyebilir).
        "GET /tasima-talepleri": (req) => ({ data: { items: req.path.includes("hedefKimlik") ? [talep] : [talep, other], nextCursor: null } }),
      },
    });
    const lists = () => calls.filter((c) => c.method === "GET" && c.path.startsWith("/tasima-talepleri"));
    await screen.findByText("kid-baska-hedef");
    expect(lists().every((c) => !c.path.includes("hedefKimlik"))).toBe(true);
    await user.type(screen.getByLabelText("Hedef lisans kimliği"), ` ${HEDEF} `);
    expect(lists().some((c) => c.path.includes("hedefKimlik"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Süz" }));
    await screen.findByRole("button", { name: "Süzgeci kaldır" });
    expect(lists().at(-1)!.path).toContain(`hedefKimlik=${HEDEF}`);
    expect(screen.queryByText("kid-baska-hedef")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Süzgeci kaldır" }));
    expect(await screen.findByText("kid-baska-hedef")).toBeInTheDocument();
    expect((screen.getByLabelText("Hedef lisans kimliği") as HTMLInputElement).value).toBe("");
    await user.click(screen.getAllByTitle("Bu hedefin taleplerini süz")[0]!);
    expect((screen.getByLabelText("Hedef lisans kimliği") as HTMLInputElement).value).toBe(HEDEF);
    await screen.findByRole("button", { name: "Süzgeci kaldır" });
    expect(screen.queryByText("kid-baska-hedef")).toBeNull();
  });
});
