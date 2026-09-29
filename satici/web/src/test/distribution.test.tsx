// DAĞITIM ARAYÜZÜ (Faz 3d) — ilk kurulum bağlantısı · dosyalar · sürümler.
//   · artımlı SHA-256 Node'un sha256'sıyla birebir (tarayıcı bütün dosyayı belleğe almadan özetler)
//   · giden yükleme: oturum işlem kimliğiyle; alınmış parça ATLANIR, eksik parça özet başlığıyla gider, sonra tamamla
//   · ilk kurulum bağlantısı: adres yalnız canlı yanıtta; tekrar yanıtı "gösterilemez" der
//   · sürümler: yayın kökü bağlı değilse "ölçülemedi" (boş liste "yayın yok" sayılmaz); yayıncı kaydı yalnız yöneticiye
//   · dosyalar: gövdesi budanan dosyada indirme bağlantısı yok, "Gövde budandı" rozeti
import { Blob as NodeBlob } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Sha256 } from "../portal/distribution/sha256";
import { partUrl, uploadOutgoing } from "../portal/distribution/upload";
import { PORTAL_ROUTES } from "../portal/routes";
import { ApiError, type ApiClient } from "../shared/api";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const nodeSha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const CUSTOMER = "5b0c6a4e-4444-4000-8000-000000000004";

describe("artımlı SHA-256", () => {
  it("Node ile birebir (parçalı besleme, sınır boyları)", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70_001]) {
      const b = randomBytes(n);
      const s = new Sha256();
      for (let i = 0; i < n; i += 333) s.update(b.subarray(i, i + 333));
      expect(s.hex()).toBe(nodeSha(b));
    }
  });
});

describe("giden yükleme", () => {
  it("alınmış parçayı atlar, eksikleri özet başlığıyla gönderir, sonra tamamlar", async () => {
    const data = randomBytes(2500);
    const file = { name: "kilavuz.pdf", size: data.length, type: "application/pdf", slice: (a: number, b: number) => new NodeBlob([data.subarray(a, b)]) as unknown as Blob };
    const posts: { path: string; body: unknown }[] = [];
    const api = {
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        if (path === "/dagitim/giden-oturum") return { oturumId: "o1", durum: "ACIK", parcaBayt: 1000, parcaSayisi: 3, alinanlar: [1], dosyaId: null };
        return { dosyaId: "d1" };
      },
    } as unknown as ApiClient;
    const puts: { url: string; sha: string; size: number }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const blob = init.body as Blob;
      puts.push({ url, sha: (init.headers as Record<string, string>)["X-Parca-Sha256"]!, size: blob.size });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadOutgoing({ api, customerId: CUSTOMER, file, clientToken: "t-1", partBytes: 1000, fetchImpl });
    expect(r.dosyaId).toBe("d1");
    expect(posts[0]!.body).toMatchObject({ clientToken: "t-1", musteriId: CUSTOMER, dosyaAdi: "kilavuz.pdf", boyut: 2500, sha256: nodeSha(data) });
    expect(puts.map((p) => p.url)).toEqual([partUrl("o1", 0), partUrl("o1", 2)]);
    expect(puts[1]!.sha).toBe(nodeSha(data.subarray(2000)));
    expect(posts[1]!.path).toBe("/dagitim/giden-oturum/o1/tamamla");
  });

  it("sunucunun bütünlük reddi ApiError koduyla yükselir (tamamlama çağrılmaz)", async () => {
    const file = { name: "a.pdf", size: 10, type: "", slice: () => new NodeBlob([new Uint8Array(10)]) as unknown as Blob };
    const posts: string[] = [];
    const api = { post: async (path: string) => (posts.push(path), { oturumId: "o2", durum: "ACIK", parcaBayt: 50, parcaSayisi: 1, alinanlar: [], dosyaId: null }) } as unknown as ApiClient;
    const fetchImpl = (async () => new Response(JSON.stringify({ success: false, message: "Parça özeti tutmadı", details: { code: "PARCA_BUTUNLUGU" } }), { status: 422 })) as unknown as typeof fetch;
    const err = await uploadOutgoing({ api, customerId: CUSTOMER, file, clientToken: "t-2", partBytes: 50, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("PARCA_BUTUNLUGU");
    expect(posts).toEqual(["/dagitim/giden-oturum"]);
  });
});

function openInstallation(role: "SATICI_OPERATOR" | "SATICI_YONETICI", extra: Record<string, Handler>) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: installationDetail() }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ data: [] }),
      "GET /dagitim/baglantilar": () => ({ data: [] }),
      "GET /dagitim/derlemeler": () => ({ data: [{ ad: "TeksERP-Kurulum-ornek.exe", boyut: 1000, degisti: "2026-09-30T10:00:00Z" }] }),
      ...extra,
    },
  });
}

describe("ilk kurulum bağlantısı", () => {
  it("adres yalnız canlı yanıtta gösterilir; gövde derleme + kurulum + müşteriyi taşır", async () => {
    const user = userEvent.setup();
    const adres = "https://lisans.ornek.test/d/abcdefghijklmnopqrstuvwxyzABCDEF";
    const { calls } = openInstallation("SATICI_OPERATOR", { "POST /dagitim/baglantilar": () => ({ status: 201, data: { baglanti: {}, belirtec: "x", yol: "/d/x", adres } }) });
    await user.click(await screen.findByRole("tab", { name: "İlk kurulum" }));
    await user.click(await screen.findByRole("button", { name: "Bağlantı ver" }));
    const dialog = await screen.findByRole("dialog", { name: "İlk kurulum bağlantısı ver" });
    await user.selectOptions(within(dialog).getAllByRole("combobox")[0]!, "TeksERP-Kurulum-ornek.exe");
    await user.click(within(dialog).getByRole("button", { name: "Bağlantı ver" }));
    expect((await screen.findByTestId("once-secret")).textContent).toBe(adres);
    const w = writes(calls)[0]!;
    expect(w.body).toMatchObject({ tur: "ILK_KURULUM", derlemeAdi: "TeksERP-Kurulum-ornek.exe", kurulumId: INSTALLATION_DB_ID, musteriId: CUSTOMER });
    expect(typeof w.body!.clientToken).toBe("string");
  });

  it("tekrar yanıtı adresi taşımaz ve bunu açıkça söyler", async () => {
    const user = userEvent.setup();
    openInstallation("SATICI_OPERATOR", { "POST /dagitim/baglantilar": () => ({ status: 201, data: { baglanti: {}, belirtecGosterilemez: true } }) });
    await user.click(await screen.findByRole("tab", { name: "İlk kurulum" }));
    await user.click(await screen.findByRole("button", { name: "Bağlantı ver" }));
    const dialog = await screen.findByRole("dialog", { name: "İlk kurulum bağlantısı ver" });
    await user.selectOptions(within(dialog).getAllByRole("combobox")[0]!, "TeksERP-Kurulum-ornek.exe");
    await user.click(within(dialog).getByRole("button", { name: "Bağlantı ver" }));
    expect(await screen.findByText(/artık gösterilemez/)).toBeTruthy();
    expect(screen.queryByTestId("once-secret")).toBeNull();
  });
});

const RELEASES_EMPTY = { yayinKoku: "BAGLI_DEGIL", kanallar: [{ kod: "testfabrika", kayitli: { ad: "Test", tur: "hazirlik", guncelSurumler: { panel: "1.3.9" } }, yayinda: null, defter: null, bildirimler: [] }] };

function openReleases(role: "SATICI_OPERATOR" | "SATICI_YONETICI", overview: unknown) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/surumler",
    handlers: { "GET /oturum": () => ({ data: sessionFor(role) }), "GET /surumler": () => ({ data: overview }), "GET /yayincilar": () => ({ data: [] }) },
  });
}

describe("sürümler", () => {
  it("yayın kökü bağlı değilse yayında olan 'ölçülemedi' (boş = yayın yok DEĞİL); kayıtlı sürüm görünür", async () => {
    openReleases("SATICI_OPERATOR", RELEASES_EMPTY);
    expect(await screen.findByText(/Yayın kökü bağlı değil/)).toBeTruthy();
    expect(screen.getByText("ölçülemedi")).toBeTruthy();
    expect(screen.getByText("panel 1.3.9")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Anahtar kaydet" })).toBeNull();
  });

  it("yayında olan sürümler ve son bildirim; yayıncı kaydı yöneticiye görünür", async () => {
    openReleases("SATICI_YONETICI", {
      yayinKoku: "OLCULDU",
      kanallar: [
        {
          kod: "adnansahin",
          kayitli: { ad: "A", tur: "uretim", guncelSurumler: {} },
          yayinda: { panel: { surum: "1.4.0", degisti: null }, tabletOta: [{ runtime: "54.2", surum: "2.9.9", degisti: null }], tabletApk: { surum: "2.9.9", vc: 60, degisti: null } },
          defter: [],
          bildirimler: [{ id: "n1", olay: "TERFI", urun: "panel", kanalKodu: "adnansahin", surum: "1.4.0", yayinciKid: "yayinci-mac-1", olayZamani: "2026-09-30T10:00:00Z", ayrinti: null }],
        },
      ],
    });
    expect(await screen.findByText("Panel 1.4.0 · OTA 54.2: 2.9.9 · APK 2.9.9 (vc 60)")).toBeTruthy();
    expect(screen.getByText(/^Terfi panel 1\.4\.0/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anahtar kaydet" })).toBeTruthy();
  });
});

describe("dosyalar", () => {
  it("gövdesi budanan dosyada indirme yok ve rozet var; taze dosya ham uçtan iner", async () => {
    const file = (id: string, budandi: string | null) => ({ id, musteriId: CUSTOMER, yon: "GELEN", ad: `${id}.pdf`, mime: "application/pdf", boyut: 10, sha256: "0".repeat(64), saklamaBitis: "2026-10-30T10:00:00Z", govdeBudandiAt: budandi, yukleyen: "musteri:yukleme/abcd", createdAt: "2026-09-30T10:00:00Z" });
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: `/dosyalar?musteriId=${CUSTOMER}`,
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
        "GET /musteriler": () => ({ data: { items: [{ id: CUSTOMER, ad: "Örnek Tekstil" }], nextCursor: null } }),
        "GET /dagitim/dosyalar": () => ({ data: [file("eski", "2026-09-29T10:00:00Z"), file("taze", null)] }),
        "GET /dagitim/baglantilar": () => ({ data: [] }),
        "GET /dagitim/yukleme-istekleri": () => ({ data: [] }),
        "GET /dagitim/defter": () => ({ data: [{ id: "l1", olay: "GOVDE_BUDANDI", yapan: "sistem:saklama", ayrinti: null, createdAt: "2026-09-29T10:00:00Z" }] }),
      },
    });
    expect(await screen.findByText("Gövde budandı")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "İndir" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/portal/api/ham/dosyalar/taze"]);
    expect(screen.getByText("Gövde budandı (saklama)")).toBeTruthy();
  });
});
