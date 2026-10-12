// GEÇİCİ AÇILIŞ KODU (bayi) — bayi kodu imzalayamaz, TALEP açar (istek kodu biçimi · gün 7–90 · not zorunlu; parola YOK);
// kendi talepleri listede, üretilen kod talebin altında kopyalanabilir; uçlar yalnız bayi kapsamındaki kurulum yolları.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BAYI_ROUTES } from "../bayi/routes";
import type { TempCodeRequest } from "../shared/types";
import { INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const GROUPED = "TI-ABCD-1234-EFGH-5678-JKMN-9P0Q";
const CODE = ["TG", ...Array.from({ length: 23 }, (_, i) => `B${String(i).padStart(2, "0")}CD`)].join("-");
const base = (over: Partial<TempCodeRequest>): TempCodeRequest => ({
  id: "7d0c6a4e-1111-4000-8000-000000000051",
  kurulumId: INSTALLATION_DB_ID,
  istekKodu: GROUPED,
  gun: 30,
  sebep: "fabrikada internet yok",
  yapan: "bayi:ornek",
  durum: "BEKLIYOR",
  kapanisZamani: null,
  kapatan: null,
  kapanisSebebi: null,
  createdAt: "2026-10-12T09:00:00.000Z",
  kod: null,
  ...over,
});

function open(rows: TempCodeRequest[], extra: Record<string, Handler> = {}, detail = installationDetail()) {
  return renderApp({
    base: "/bayi/api",
    routes: BAYI_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("BAYI") }),
      "GET /ben": () => ({ data: { tavan: null, anahtarBagli: true } }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod-talepleri`]: () => ({ data: rows }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/tasima-talepleri`]: () => ({ data: [] }),
      ...extra,
    },
  });
}

describe("bayi — geçici kod talebi", () => {
  it("⭐ talep: istek kodu + gün + not, parola YOK; gövde KATI; liste tazelenir", async () => {
    const user = userEvent.setup();
    let rows: TempCodeRequest[] = [];
    const { calls } = open([], {
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod-talepleri`]: () => ({ data: rows }),
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod-talep`]: () => {
        rows = [base({ gun: 14 })];
        return { status: 201, data: { id: rows[0]!.id, durum: "BEKLIYOR", gun: 14 } };
      },
    });
    await user.click(await screen.findByRole("button", { name: "Geçici kod talep et…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici kod talep et" });
    expect(within(dialog).queryByLabelText(/parola/i)).toBeNull();
    expect((within(dialog).getByLabelText("Gün") as HTMLInputElement).value).toBe("30");
    await user.click(within(dialog).getByLabelText("İstek kodu"));
    await user.paste("abcd1234efgh5678jkmn9poq");
    expect((within(dialog).getByLabelText("İstek kodu") as HTMLInputElement).value).toBe(GROUPED);
    await user.clear(within(dialog).getByLabelText("Gün"));
    await user.type(within(dialog).getByLabelText("Gün"), "14");
    const button = within(dialog).getByRole("button", { name: "Talebi gönder" });
    expect(button).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Not"), "fabrikada internet yok");
    await user.click(button);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/gecici-kod-talep`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "gun", "istekKodu", "sebep"]);
    expect(w[0]!.body).toMatchObject({ istekKodu: "ABCD1234EFGH5678JKMN9P0Q", gun: 14, sebep: "fabrikada internet yok" });
    expect(await screen.findByText("Bekliyor")).toBeInTheDocument();
  });

  it("✓K biçimsiz istek kodu ve aralık dışı gün düğmeyi kapatır", async () => {
    const user = userEvent.setup();
    open([]);
    await user.click(await screen.findByRole("button", { name: "Geçici kod talep et…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici kod talep et" });
    await user.type(within(dialog).getByLabelText("Not"), "not");
    await user.click(within(dialog).getByLabelText("İstek kodu"));
    await user.paste("TI-ABCD-12");
    const button = within(dialog).getByRole("button", { name: "Talebi gönder" });
    expect(within(dialog).getByText(/24 karakter/)).toBeInTheDocument();
    expect(button).toBeDisabled();
    await user.paste("34EFGH5678JKMN9P0Q");
    expect(button).toBeEnabled();
    await user.clear(within(dialog).getByLabelText("Gün"));
    await user.type(within(dialog).getByLabelText("Gün"), "120");
    expect(button).toBeDisabled();
  });

  it("⭐ üretilen kod talebin altında: 23 grup + Kopyala", async () => {
    const user = userEvent.setup();
    open([base({ durum: "URETILDI", kod: { kod: CODE, bitis: "2026-11-11T00:00:00.000Z", tuketildiAt: null } })]);
    const code = await screen.findByTestId("temp-code");
    expect(within(code).getAllByText(/.+/)).toHaveLength(24);
    await user.click(screen.getByRole("button", { name: "Kopyala" }));
    expect(await navigator.clipboard.readText()).toBe(CODE);
  });

  it("reddedilen talepte gerekçe; tüketilmiş kodda metin yerine kullanım anı", async () => {
    open([
      base({ durum: "REDDEDILDI", kapanisSebebi: "kurulum taşınıyor" }),
      base({ id: "7d0c6a4e-1111-4000-8000-000000000052", durum: "URETILDI", kod: { kod: CODE, bitis: "2026-11-11T00:00:00.000Z", tuketildiAt: "2026-10-13T08:00:00.000Z" } }),
    ]);
    expect(await screen.findByText("Ret gerekçesi: kurulum taşınıyor")).toBeInTheDocument();
    expect(screen.getByText(/Kod fabrikada kullanıldı/)).toBeInTheDocument();
    expect(screen.queryByTestId("temp-code")).toBeNull();
  });

  it("✓K iptal edilmiş kurulumda talep düğmesi yok", async () => {
    const d = installationDetail();
    open([], {}, { ...d, kurulum: { ...d.kurulum, durum: "IPTAL" } });
    expect(await screen.findByText("Bu kurulum için talep yok.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Geçici kod talep et…" })).toBeNull();
  });
});
