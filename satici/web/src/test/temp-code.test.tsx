// GEÇİCİ AÇILIŞ KODU (satıcı) — kurulum künyesindeki üretim formu (istek kodu biçimi · gün 7–90 · kök parolası zorunlu),
// bir kez gösterilen kod + kopyala, metinsiz liste ve bayi talepleri kuyruğu (üret / reddet); yazma yalnız yöneticiye.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { PortalRole } from "../shared/permissions";
import { checkRequestCode, formatRequestCode } from "../shared/temp-code";
import type { TempCodeIssued, TempCodeRequest, TempCodeRow } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const BODY = "ABCD1234EFGH5678JKMN9P0Q";
const GROUPED = "TI-ABCD-1234-EFGH-5678-JKMN-9P0Q";
const CODE = ["TG", ...Array.from({ length: 23 }, (_, i) => `A${String(i).padStart(2, "0")}BC`)].join("-");
const ISSUED: TempCodeIssued = { id: "6c0c6a4e-1111-4000-8000-000000000021", kodNo: 7, kod: CODE, bitis: "2026-11-11T00:00:00.000Z", gun: 30 };
const ROWS: TempCodeRow[] = [
  {
    id: "6c0c6a4e-1111-4000-8000-000000000031",
    kodNo: 5,
    istekKodu: GROUPED,
    gun: 30,
    bitis: "2099-01-01T00:00:00.000Z",
    imzalayanKid: "kok-2026-1",
    kodSonu: "ZX9Q",
    talepId: null,
    ureten: "portal:deneme",
    tuketildiAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "6c0c6a4e-1111-4000-8000-000000000032",
    kodNo: 4,
    istekKodu: GROUPED,
    gun: 7,
    bitis: "2026-09-08T00:00:00.000Z",
    imzalayanKid: "kok-2026-1",
    kodSonu: "K7M2",
    talepId: null,
    ureten: "portal:deneme",
    tuketildiAt: "2026-09-02T08:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
  },
];
const REQUEST: TempCodeRequest = {
  id: "6c0c6a4e-1111-4000-8000-000000000041",
  kurulumId: INSTALLATION_DB_ID,
  istekKodu: GROUPED,
  gun: 14,
  sebep: "fabrikada internet yok",
  yapan: "bayi:ornek",
  durum: "BEKLIYOR",
  kapanisZamani: null,
  kapatan: null,
  kapanisSebebi: null,
  createdAt: "2026-10-12T09:00:00.000Z",
  kurulum: { kurulumId: "kur-1", ad: "Ana sunucu", sinif: "TICARI" },
  bayi: "Örnek Bayi",
};

function openDetail(role: PortalRole, extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/gecici-kodlar`]: () => ({ data: { kodlar: ROWS, talepler: [REQUEST] } }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
}

async function fillIssue(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, opts: { code?: string; days?: string; password?: string } = {}) {
  const input = within(dialog).getByLabelText("İstek kodu");
  await user.click(input);
  await user.paste(opts.code ?? "ti abcd 1234 efgh 5678 jkmn 9p oq");
  if (opts.days !== undefined) {
    const days = within(dialog).getByLabelText("Gün");
    await user.clear(days);
    if (opts.days) await user.type(days, opts.days);
  }
  await user.type(within(dialog).getByLabelText(/^Sebep/), "telefonla etkinleştirme");
  if (opts.password !== "") await user.type(within(dialog).getByLabelText(/^Kök parolası/), opts.password ?? "gizli");
}

describe("istek kodu biçimi (yazım yardımı)", () => {
  it("yapıştırılan biçimsiz metin gruplanır; O→0, I/L→1", () => {
    expect(formatRequestCode("ti abcd1234efgh5678jkmn9poq")).toBe(GROUPED);
    expect(checkRequestCode("TI-ABCD-1234-EFGH-5678-JKMN-9POQ")).toEqual({ ok: true, body: BODY });
    expect(checkRequestCode("abcd-1234-efgh-5678-jkmn-9pol")).toEqual({ ok: true, body: "ABCD1234EFGH5678JKMN9P01" });
  });
  it("✓K alfabe dışı karakterin grubu söylenir; eksik uzunluk reddedilir; boş sessiz", () => {
    expect(checkRequestCode("TI-ABCD-12U4")).toEqual({ ok: false, message: "2. grupta geçersiz karakter: “U”" });
    expect(checkRequestCode("TI-ABCD-1234")).toMatchObject({ ok: false, message: expect.stringContaining("24 karakter") });
    expect(checkRequestCode("  ")).toEqual({ ok: false, message: null });
  });
});

describe("kurulum künyesi — geçici açılış kodu (satıcı)", () => {
  it("⭐ yönetici: yapıştır → gruplanır, gün 30 varsayılan, gövde KATI → kod 23 grup, uyarı, kopyala", async () => {
    const user = userEvent.setup();
    const { calls } = openDetail("SATICI_YONETICI", { [`POST /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod`]: () => ({ status: 201, data: ISSUED }) });
    await user.click(await screen.findByRole("button", { name: "Geçici açılış kodu üret…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici açılış kodu üret" });
    expect((within(dialog).getByLabelText("Gün") as HTMLInputElement).value).toBe("30");
    await fillIssue(user, dialog);
    expect((within(dialog).getByLabelText("İstek kodu") as HTMLInputElement).value).toBe(GROUPED);
    await user.click(within(dialog).getByRole("button", { name: "Kodu üret" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/gecici-kod`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "gun", "imzaParolasi", "istekKodu", "sebep"]);
    expect(w[0]!.body).toMatchObject({ istekKodu: BODY, gun: 30, sebep: "telefonla etkinleştirme", imzaParolasi: "gizli" });
    const ready = await screen.findByRole("dialog", { name: "Geçici açılış kodu" });
    expect(within(ready).getByText(/bir daha gösterilmez/)).toBeInTheDocument();
    expect(within(within(ready).getByTestId("temp-code")).getAllByText(/.+/)).toHaveLength(24);
    await user.click(within(ready).getByRole("button", { name: "Kopyala" }));
    expect(await navigator.clipboard.readText()).toBe(CODE);
    expect(within(ready).getByText(/Panoya kopyalandı/)).toBeInTheDocument();
  });

  it("✓K kök parolası, geçerli istek kodu ve 7–90 gün olmadan düğme kapalı", async () => {
    const user = userEvent.setup();
    openDetail("SATICI_YONETICI");
    await user.click(await screen.findByRole("button", { name: "Geçici açılış kodu üret…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici açılış kodu üret" });
    await fillIssue(user, dialog, { password: "" });
    const button = within(dialog).getByRole("button", { name: "Kodu üret" });
    expect(button).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Kök parolası/), "gizli");
    expect(button).toBeEnabled();
    for (const d of ["6", "91", ""]) {
      await user.clear(within(dialog).getByLabelText("Gün"));
      if (d) await user.type(within(dialog).getByLabelText("Gün"), d);
      expect(button).toBeDisabled();
    }
    await user.type(within(dialog).getByLabelText("Gün"), "90");
    expect(button).toBeEnabled();
    await user.clear(within(dialog).getByLabelText("İstek kodu"));
    await user.paste("TI-ABCD-12U4");
    expect(within(dialog).getByText("2. grupta geçersiz karakter: “U”")).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("hatalı kök parolası → iletisi, parola alanı boşalır", async () => {
    const user = userEvent.setup();
    openDetail("SATICI_YONETICI", { [`POST /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod`]: () => ({ status: 403, code: "IMZA_PAROLASI_HATALI" }) });
    await user.click(await screen.findByRole("button", { name: "Geçici açılış kodu üret…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici açılış kodu üret" });
    await fillIssue(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Kodu üret" }));
    expect(await within(dialog).findByText(/Kök parolası hatalı/)).toBeInTheDocument();
    expect((within(dialog).getByLabelText(/^Kök parolası/) as HTMLInputElement).value).toBe("");
  });

  it("tekrar yanıtı kodu taşımaz → “gösterilemez”", async () => {
    const user = userEvent.setup();
    openDetail("SATICI_YONETICI", {
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/gecici-kod`]: () => ({ status: 201, data: { ...ISSUED, kod: null, kodGosterilemez: true } }),
    });
    await user.click(await screen.findByRole("button", { name: "Geçici açılış kodu üret…" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici açılış kodu üret" });
    await fillIssue(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Kodu üret" }));
    const ready = await screen.findByRole("dialog", { name: "Geçici açılış kodu" });
    expect(within(ready).getByText(/artık gösterilemez/)).toBeInTheDocument();
    expect(within(ready).queryByTestId("temp-code")).toBeNull();
  });

  it("liste kodun metnini taşımaz: son 4 · bitiş · durum (geçerli / tüketildi); bekleyen talep uyarısı", async () => {
    openDetail("SATICI_YONETICI");
    expect(await screen.findByText("…ZX9Q")).toBeInTheDocument();
    expect(screen.getByText("…K7M2")).toBeInTheDocument();
    expect(screen.getByText("Geçerli")).toBeInTheDocument();
    expect(screen.getByText(/^Tüketildi/)).toBeInTheDocument();
    expect(screen.getByText(/1 bekleyen bayi talebi/)).toBeInTheDocument();
  });

  it("✓K operatör listeyi görür, üretemez", async () => {
    openDetail("SATICI_OPERATOR");
    expect(await screen.findByText("…ZX9Q")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Geçici açılış kodu üret…" })).toBeNull();
  });

  it("✓K iptal edilmiş kuruluma üretim düğmesi yok", async () => {
    const d = installationDetail();
    openDetail("SATICI_YONETICI", { [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: { ...d, kurulum: { ...d.kurulum, durum: "IPTAL" } } }) });
    expect(await screen.findByText("…ZX9Q")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Geçici açılış kodu üret…" })).toBeNull();
  });
});

function openQueue(role: PortalRole, extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/gecici-kod-talepleri",
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      "GET /gecici-kod-talepleri": () => ({ data: [REQUEST] }),
      ...extra,
    },
  });
}

describe("geçici kod talepleri kuyruğu (satıcı)", () => {
  it("⭐ üret: kök parolası zorunlu, gövde {sebep, imzaParolasi} → kod bir kez", async () => {
    const user = userEvent.setup();
    const { calls } = openQueue("SATICI_YONETICI", { [`POST /gecici-kod-talepleri/${REQUEST.id}/uret`]: () => ({ status: 201, data: { ...ISSUED, talepId: REQUEST.id } }) });
    expect(await screen.findByText("Örnek Bayi")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Üret" }));
    const dialog = await screen.findByRole("dialog", { name: "Talepten geçici kod üret" });
    expect(within(dialog).getByText(GROUPED)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "bayi talebi uygun");
    const button = within(dialog).getByRole("button", { name: "Kodu üret" });
    expect(button).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Kök parolası/), "gizli");
    await user.click(button);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/gecici-kod-talepleri/${REQUEST.id}/uret`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "imzaParolasi", "sebep"]);
    const ready = await screen.findByRole("dialog", { name: "Geçici açılış kodu" });
    expect(within(ready).getByText(/bir daha gösterilmez/)).toBeInTheDocument();
  });

  it("reddet: etkilenen talep adıyla, sebep zorunlu", async () => {
    const user = userEvent.setup();
    const { calls } = openQueue("SATICI_YONETICI", { [`POST /gecici-kod-talepleri/${REQUEST.id}/reddet`]: () => ({ data: { id: REQUEST.id, durum: "REDDEDILDI" } }) });
    await user.click(await screen.findByRole("button", { name: "Reddet" }));
    const dialog = await screen.findByRole("dialog", { name: "Geçici kod talebini reddet" });
    expect(within(dialog).getByText(`Örnek Bayi › Ana sunucu — ${GROUPED} (14 gün)`)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "kurulum taşınıyor");
    await user.click(within(dialog).getByRole("button", { name: "Reddet" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/gecici-kod-talepleri/${REQUEST.id}/reddet`);
    expect(w[0]!.body).toMatchObject({ sebep: "kurulum taşınıyor" });
  });

  it("✓K operatör kuyruğu görür, üretemez/reddedemez", async () => {
    openQueue("SATICI_OPERATOR");
    expect(await screen.findByText("Örnek Bayi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Üret" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reddet" })).toBeNull();
  });
});
