// SIR YALNIZ BİR KEZ — etkinleştirme kodu, taşıma kodu ve TOTP sırrı/QR'ı yalnız canlı yanıtta gösterilir; pencere
// kapanınca DOM'dan, önbellekten ve yeniden çizimden gider (liste yalnız "…son 4"ü taşır). Tekrar
// yanıtı (aynı işlem kimliği, `…Gosterilemez: true`) sırrı taşımaz ve arayüz bunu açıkça söyler.
// İŞLEM KİMLİĞİ: belirsiz hatada (5xx/ağ) aynı deneme AYNI kimlikle yinelenir; başarı ya da kesin
// 4xx kimliği bırakır — sonraki deneme yeni kimliktir.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { AttemptToken } from "../shared/attempt";
import { ApiError, isAmbiguousError, NETWORK_ERROR_CODE } from "../shared/api";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const CODE = "TKSK-7Q2M-XR4P-9BDA";
const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function openEntitlement(extra: Record<string, Handler>) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
}

async function generate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Etkinleştirme kodu üret" }));
  const dialog = await screen.findByRole("dialog", { name: "Etkinleştirme kodu üret" });
  await user.click(within(dialog).getByRole("button", { name: "Üret" }));
}

describe("etkinleştirme kodu bir kez gösterilir", () => {
  it("canlı yanıtta gösterilir; kapanınca bir daha hiçbir yerde görünmez", async () => {
    const user = userEvent.setup();
    openEntitlement({
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/etkinlestirme-kodu`]: () => ({ status: 201, data: { id: "c1", kod: CODE, kodSonu: "9BDA", gecerlilikBitis: "2026-10-29T00:00:00Z" } }),
    });
    await generate(user);
    const shown = await screen.findByRole("dialog", { name: "Etkinleştirme kodu" });
    expect(within(shown).getByTestId("once-secret")).toHaveTextContent(CODE);
    await user.click(within(shown).getByRole("button", { name: "Kaydettim, kapat" }));
    expect(screen.queryByText(CODE)).toBeNull();
    expect(document.body.innerHTML).not.toContain(CODE);
  });

  it("tekrar yanıtı kodu taşımaz ve arayüz 'gösterilemez' der", async () => {
    const user = userEvent.setup();
    openEntitlement({
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/etkinlestirme-kodu`]: () => ({ status: 201, data: { id: "c1", kod: null, gecerlilikBitis: "2026-10-29T00:00:00Z", kodGosterilemez: true } }),
    });
    await generate(user);
    const shown = await screen.findByRole("dialog", { name: "Etkinleştirme kodu" });
    expect(within(shown).getByRole("alert")).toHaveTextContent("artık gösterilemez");
    expect(within(shown).queryByTestId("once-secret")).toBeNull();
  });

  it("belirsiz hatada (5xx) aynı işlem kimliğiyle yinelenir; başarıdan sonraki üretim yeni kimlik alır", async () => {
    const user = userEvent.setup();
    let n = 0;
    const { calls } = openEntitlement({
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/etkinlestirme-kodu`]: () =>
        ++n === 1 ? { status: 500, code: "SUNUCU_HATASI", message: "Beklenmeyen sunucu hatası" } : { status: 201, data: { id: `c${n}`, kod: CODE, kodSonu: "9BDA", gecerlilikBitis: "2026-10-29T00:00:00Z" } },
    });
    await generate(user);
    const dialog = await screen.findByRole("dialog", { name: "Etkinleştirme kodu üret" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Beklenmeyen sunucu hatası");
    await user.click(within(dialog).getByRole("button", { name: "Üret" }));
    await user.click(await screen.findByRole("button", { name: "Kaydettim, kapat" }));
    await generate(user);
    await screen.findByRole("dialog", { name: "Etkinleştirme kodu" });
    const tokens = writes(calls).map((c) => c.body!.clientToken);
    expect(tokens).toHaveLength(3);
    expect(tokens[1]).toBe(tokens[0]);
    expect(tokens[2]).not.toBe(tokens[0]);
  });
});

describe("TOTP kurulumu: sır ve QR yalnız hesabı açan yöneticinin ekranında bir kez", () => {
  it("yeni kullanıcı yanıtında QR + sır görünür; kapanınca gider ve liste sırrı hiç taşımaz", async () => {
    const user = userEvent.setup();
    const created = { id: "u2", kullaniciAdi: "mehmet", adSoyad: "Mehmet Y", rol: "SATICI_OPERATOR", bayiId: null, aktif: true, kilitli: false, kilitBitis: null, sonGiris: null, parolaDegisim: null, createdAt: "2026-09-29T10:00:00Z" };
    let list = [{ ...created, id: "u1", kullaniciAdi: "deneme", adSoyad: "Deneme Kullanıcı", rol: "SATICI_YONETICI" }];
    const { calls } = renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: "/kullanicilar",
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI", { id: "u1" }) }),
        "GET /kullanicilar": () => ({ data: list }),
        "GET /bayiler": () => ({ data: [] }),
        "POST /kullanicilar": () => {
          list = [...list, created];
          return { status: 201, data: { kullanici: created, totp: { sir: TOTP_SECRET, otpauthUri: `otpauth://totp/TeksERP:mehmet?secret=${TOTP_SECRET}&issuer=TeksERP` } } };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Yeni kullanıcı" }));
    const form = await screen.findByRole("dialog", { name: "Yeni portal kullanıcısı" });
    await user.type(within(form).getByLabelText(/^Kullanıcı adı/), "mehmet");
    await user.type(within(form).getByLabelText(/^Ad soyad/), "Mehmet Y");
    await user.type(within(form).getByLabelText(/^İlk parola/), "uzun-ve-guclu-parola");
    await user.click(within(form).getByRole("button", { name: "Oluştur" }));
    const shown = await screen.findByRole("dialog", { name: "Doğrulayıcı kurulumu — mehmet" });
    expect(within(shown).getByTestId("totp-qr").querySelector("svg")).not.toBeNull();
    expect(within(shown).getByTestId("once-secret")).toHaveTextContent(TOTP_SECRET);
    // Parola gövdede gider ama hiçbir yere yazılmaz; sır istek gövdesinde YOK (sunucu üretir).
    expect(writes(calls)[0]!.body).toMatchObject({ kullaniciAdi: "mehmet", rol: "SATICI_OPERATOR", bayiId: null });
    await user.click(within(shown).getByRole("button", { name: "Kaydettim, kapat" }));
    expect(await screen.findByText("Mehmet Y")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOTP_SECRET);
  });

  it("TOTP sıfırlamanın tekrar yanıtı sırrı taşımaz", async () => {
    const user = userEvent.setup();
    const target = { id: "u2", kullaniciAdi: "mehmet", adSoyad: "Mehmet Y", rol: "SATICI_OPERATOR", bayiId: null, aktif: true, kilitli: false, kilitBitis: null, sonGiris: null, parolaDegisim: null, createdAt: "2026-09-29T10:00:00Z" };
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: "/kullanicilar",
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI", { id: "u1" }) }),
        "GET /kullanicilar": () => ({ data: [target] }),
        "GET /bayiler": () => ({ data: [] }),
        "POST /kullanicilar/u2/totp-sifirla": () => ({ data: { kullanici: target, totp: null, totpGosterilemez: true } }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Doğrulama kodunu sıfırla" }));
    const confirm = await screen.findByRole("dialog", { name: "Doğrulama kodunu sıfırla" });
    expect(within(confirm).getByText(/Mehmet Y \(mehmet\)/)).toBeInTheDocument();
    await user.type(within(confirm).getByLabelText(/^Sebep/), "Telefon kayboldu");
    await user.click(within(confirm).getByRole("button", { name: "Sıfırla" }));
    const shown = await screen.findByRole("dialog", { name: "Doğrulayıcı kurulumu — mehmet" });
    expect(within(shown).getByRole("alert")).toHaveTextContent("artık gösterilemez");
    expect(within(shown).queryByTestId("totp-qr")).toBeNull();
  });
});

describe("taşıma kodu bir kez gösterilir (D8)", () => {
  const TALEP = "5b0c6a4e-5555-4000-8000-000000000005";
  const HEDEF = "5b0c6a4e-6666-4000-8000-000000000006";
  const TASIMA_KODU = "TKS-3M8Q-VX2A-7KPD-9WNE";
  const talep = {
    id: TALEP,
    kurulumId: null,
    yeniAnahtarKimligi: "kur-yeni",
    ortam: {},
    gerekce: "yeni sunucu",
    durum: "BEKLIYOR",
    kararZamani: null,
    kararVeren: null,
    kararSebebi: null,
    createdAt: "2026-09-29T08:00:00.000Z",
    onerilenKurulumlar: [{ id: HEDEF, kurulumId: "9e8d7c6b-0000-4000-8000-00000000abcd", ad: "Merkez sunucu", durum: "ETKIN", tesis: { ad: "Ana tesis", musteri: { ad: "Örnek Tekstil" } } }],
  };
  const open = (reply: Handler) =>
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: "/tasima-talepleri",
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
        "GET /tasima-talepleri": () => ({ data: { items: [talep], nextCursor: null } }),
        [`POST /tasima-talepleri/${TALEP}/onayla`]: reply,
      },
    });
  const approve = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Onayla" }));
    const dialog = await screen.findByRole("dialog", { name: "Taşımayı onayla" });
    await user.type(within(dialog).getByRole("textbox"), "müşteri aradı");
    await user.click(within(dialog).getByRole("button", { name: "Onayla ve kod üret" }));
  };

  it("kimliksiz talepte hedef öneriden gider; kod canlı yanıtta gösterilir, kapanınca hiçbir yerde görünmez", async () => {
    const user = userEvent.setup();
    const { calls } = open(() => ({ data: { id: TALEP, tasimaKodu: { id: "k1", kod: TASIMA_KODU, kodSonu: "9WNE", gecerlilikBitis: "2026-10-29T00:00:00Z" } } }));
    await approve(user);
    const shown = await screen.findByRole("dialog", { name: "Taşıma kodu" });
    expect(within(shown).getByTestId("once-secret")).toHaveTextContent(TASIMA_KODU);
    expect(writes(calls)[0]!.body).toMatchObject({ kurulumId: HEDEF, sebep: "müşteri aradı" });
    await user.click(within(shown).getByRole("button", { name: "Kaydettim, kapat" }));
    expect(document.body.innerHTML).not.toContain(TASIMA_KODU);
  });

  it("tekrar yanıtı kodu taşımaz ve arayüz 'gösterilemez' der", async () => {
    const user = userEvent.setup();
    open(() => ({ data: { id: TALEP, tasimaKodu: { id: "k1", kod: null, gecerlilikBitis: "2026-10-29T00:00:00Z", kodGosterilemez: true } } }));
    await approve(user);
    const shown = await screen.findByRole("dialog", { name: "Taşıma kodu" });
    expect(within(shown).getByRole("alert")).toHaveTextContent("artık gösterilemez");
    expect(within(shown).queryByTestId("once-secret")).toBeNull();
  });
});

describe("işlem kimliği yaşam döngüsü", () => {
  it("belirsiz hatada yapışır, kesin 4xx ve başarıda bırakılır", () => {
    let i = 0;
    const t = new AttemptToken(() => `k${++i}`);
    const first = t.current();
    t.settle("ambiguous");
    expect(t.current()).toBe(first);
    t.settle("definitive");
    expect(t.current()).not.toBe(first);
    const second = t.current();
    t.settle("success");
    expect(t.current()).not.toBe(second);
  });

  it("belirsiz hata sınıfı: ağ · 5xx · 409 tekrar deneyin; kesin: 400 · 403 · 409 durum çakışması", () => {
    expect(isAmbiguousError(new ApiError(0, NETWORK_ERROR_CODE, "x"))).toBe(true);
    expect(isAmbiguousError(new ApiError(500, "SUNUCU_HATASI", "x"))).toBe(true);
    expect(isAmbiguousError(new ApiError(409, "TEKRAR_DENEYIN", "x"))).toBe(true);
    expect(isAmbiguousError(new ApiError(400, "GOVDE_GECERSIZ", "x"))).toBe(false);
    expect(isAmbiguousError(new ApiError(403, "YETKISIZ", "x"))).toBe(false);
    expect(isAmbiguousError(new ApiError(409, "DURUM_CAKISMASI", "x"))).toBe(false);
    expect(isAmbiguousError(new ApiError(409, "ISLEM_KIMLIGI_CAKISTI", "x"))).toBe(false);
  });
});
