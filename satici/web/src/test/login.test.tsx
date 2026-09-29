// GİRİŞ + TOTP AKIŞI — kullanıcı adı + parola + doğrulama kodu TEK adımda; kod 6–8 hane olmadan
// düğme kapalı; başarısız denemede tek ileti, kod ve parola temizlenir (kilitte parola kalır);
// başarıda menü çizilir. Oturum düşünce (401 OTURUM_YOK) giriş ekranına "süresi doldu" ile dönülür.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { renderApp, sessionFor, type Handler } from "./harness";

const DASHBOARD = { kurulumlar: { ETKIN: 2 }, acikKopyaUyarisi: 0, bekleyenTasima: 1, gecikenTaksit: 0, yediGundePlanliEylem: 0, yirmiDortSaattirSessiz: 0 };
const noSession: Handler = () => ({ status: 401, code: "OTURUM_YOK", message: "Oturum yok" });

async function fill(user: ReturnType<typeof userEvent.setup>, u: string, p: string, t: string) {
  await user.clear(screen.getByLabelText(/^Kullanıcı adı/));
  await user.type(screen.getByLabelText(/^Kullanıcı adı/), u);
  if (p) await user.type(screen.getByLabelText(/^Parola/), p);
  if (t) await user.type(screen.getByLabelText(/^Doğrulama kodu/), t);
}

describe("giriş (parola + TOTP tek adım)", () => {
  it("doğrulama kodu 6 hane olmadan giriş düğmesi kapalıdır", async () => {
    const user = userEvent.setup();
    renderApp({ base: "/portal/api", routes: PORTAL_ROUTES, handlers: { "GET /oturum": noSession } });
    await screen.findByRole("form", { name: "Giriş" });
    await fill(user, "ayse", "cok-gizli-parola", "12345");
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeDisabled();
    await user.type(screen.getByLabelText(/^Doğrulama kodu/), "6");
    expect(screen.getByRole("button", { name: "Giriş yap" })).toBeEnabled();
  });

  it("yanlış kod: tek ileti, kod ve parola temizlenir; doğru kodla girer ve menü görünür", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const { calls } = renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      handlers: {
        "GET /oturum": noSession,
        "POST /oturum/ac": () => (++attempts === 1 ? { status: 401, code: "GIRIS_BASARISIZ", message: "Kullanıcı adı, parola ya da doğrulama kodu hatalı" } : { data: sessionFor("SATICI_YONETICI") }),
        "GET /pano": () => ({ data: DASHBOARD }),
      },
    });
    await screen.findByRole("form", { name: "Giriş" });
    await fill(user, "ayse", "cok-gizli-parola", "111111");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kullanıcı adı, parola ya da doğrulama kodu hatalı");
    expect(screen.getByLabelText(/^Doğrulama kodu/)).toHaveValue("");
    expect(screen.getByLabelText(/^Parola/)).toHaveValue("");

    await fill(user, "ayse", "cok-gizli-parola", "222 333");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByRole("navigation", { name: "Ana menü" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portal kullanıcıları" })).toBeInTheDocument();
    const logins = calls.filter((c) => c.method === "POST" && c.path === "/oturum/ac");
    expect(logins).toHaveLength(2);
    // Gövde yalnız üç alan taşır (sunucu KATI şema); kod boşluksuz gider.
    expect(logins[1]!.body).toEqual({ kullaniciAdi: "ayse", parola: "cok-gizli-parola", totp: "222333" });
  });

  it("hesap kilidinde parola korunur, kod temizlenir", async () => {
    const user = userEvent.setup();
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      handlers: { "GET /oturum": noSession, "POST /oturum/ac": () => ({ status: 423, code: "GIRIS_KILITLI", message: "Hesap geçici olarak kilitli" }) },
    });
    await screen.findByRole("form", { name: "Giriş" });
    await fill(user, "ayse", "cok-gizli-parola", "123456");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hesap geçici olarak kilitli");
    expect(screen.getByLabelText(/^Parola/)).toHaveValue("cok-gizli-parola");
    expect(screen.getByLabelText(/^Doğrulama kodu/)).toHaveValue("");
  });

  it("operatör menüsünde yalnız yöneticinin sayfaları çizilmez", async () => {
    renderApp({ base: "/portal/api", routes: PORTAL_ROUTES, handlers: { "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }), "GET /pano": () => ({ data: DASHBOARD }) } });
    expect(await screen.findByRole("navigation", { name: "Ana menü" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Portal kullanıcıları" })).toBeNull();
    expect(screen.getByRole("link", { name: "Bayiler" })).toBeInTheDocument();
  });

  it("oturum düşünce giriş ekranına 'süresi doldu' ile dönülür", async () => {
    let alive = true;
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_YONETICI") }),
        "GET /pano": () => {
          if (alive) {
            alive = false;
            return { status: 401, code: "OTURUM_YOK", message: "Oturum yok" };
          }
          return { data: DASHBOARD };
        },
      },
    });
    await waitFor(() => expect(screen.getByText("Oturumunuz sona erdi; yeniden giriş yapın.")).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: "Ana menü" })).toBeNull();
  });
});
