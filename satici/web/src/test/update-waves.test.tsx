// GÜNCELLEME DALGASI ekranları (F1b; sunucu yarısı F1a, bekçi `satici/sunucu/scripts/test_guncelleme_dalgasi.ts`).
// Ölçülen: liste (aşama · sayaç · uyarı rozeti) · izinsiz rolde düğme yok · dalga açma gövdesi · ayrıntıda insan
// sabitlemesi ile dalga tavanı AYRI · ilerletmede ek onay adımı (sayaçtan ya da sunucunun 400'ünden) · işlem kimliği
// deneme başına (kesin 4xx bırakır, belirsiz 5xx yapışır) · geri çekmede etkilenen kurulumlar adıyla + hedef aşama.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { PortalRole } from "../shared/permissions";
import type { FleetRow, UpdateWave, UpdateWaveDetail, WaveMember, WaveTally } from "../shared/types";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const WAVE_ID = "7c0c6a4e-0001-4000-8000-000000000001";
const OLD_WAVE_ID = "7c0c6a4e-0002-4000-8000-000000000002";
const A = "5b0c6a4e-aaaa-4000-8000-000000000001";
const B = "5b0c6a4e-bbbb-4000-8000-000000000002";
const C = "5b0c6a4e-cccc-4000-8000-000000000003";

const counts = (kurulum: number, t = 0, g = 0, b = 0) => ({ kurulum, TAMAMLANDI: t, GERI_DONDU: g, BASARISIZ: b, BEKLIYOR: kurulum - t - g - b });

function tally(over: Partial<WaveTally> = {}): WaveTally {
  return {
    asamalar: [{ asama: 1, ...counts(1, 1) }, { asama: 2, ...counts(1) }, { asama: 3, ...counts(1) }],
    dalgada: counts(2, 1),
    hata: 0,
    uyariAcik: false,
    bildirimYuzdesi: 50,
    ilerletmeEkOnayIster: false,
    ...over,
  };
}

function member(id: string, kurulumId: string, girisAsamasi: number, dalgada: boolean, sonuc: string): WaveMember {
  return { id, kurulumId, kova: girisAsamasi * 20, girisAsamasi, dalgada, kuruluSurum: sonuc === "TAMAMLANDI" ? "2.12.0" : "2.11.4", sonuc, kaynak: sonuc === "TAMAMLANDI" ? "DEFTER" : null };
}

function wave(over: Partial<UpdateWaveDetail> = {}): UpdateWaveDetail {
  return {
    id: WAVE_ID,
    kanalKodu: "genel",
    surum: "2.12.0",
    oncekiSurum: "2.11.4",
    asama: 2,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
    yururlukte: true,
    sayac: tally(),
    uyeler: [member(A, "a1111111-0000", 1, true, "TAMAMLANDI"), member(B, "b2222222-0000", 2, true, "BEKLIYOR"), member(C, "c3333333-0000", 3, false, "BEKLIYOR")],
    gecmis: [
      { id: "l2", dalgaId: WAVE_ID, olay: "ASAMA_ILERLETILDI", oncekiAsama: 1, yeniAsama: 2, sebep: "Kanarya temiz", ekOnay: true, ayrinti: null, yapan: "portal:ayse", createdAt: "2026-10-08T09:00:00.000Z" },
      { id: "l1", dalgaId: WAVE_ID, olay: "DALGA_ACILDI", oncekiAsama: null, yeniAsama: 0, sebep: "2.12.0 yayını", ekOnay: false, ayrinti: null, yapan: "portal:ayse", createdAt: "2026-10-08T08:00:00.000Z" },
    ],
    ...over,
  };
}

function fleetRow(id: string, ad: string, pin: string | null): FleetRow {
  return {
    id,
    kurulumId: `${id.slice(0, 8)}-k`,
    ad,
    musteri: "Örnek Tekstil",
    tesis: "Ana tesis",
    kanal: "genel",
    sinif: "URETIM",
    durum: "ETKIN",
    sonYoklama: null,
    kuruluSurum: null,
    kanalSurumu: { surum: "2.12.0", kaynak: "YAYIN" },
    geride: null,
    politika: { kip: "OTOMATIK", pencere: null, hedefSurum: pin },
    rapor: null,
    raporZamani: null,
    sonSonuc: null,
  };
}

const FLEET = [fleetRow(A, "Dokuma sunucusu", null), fleetRow(B, "Boya sunucusu", "2.11.9"), fleetRow(C, "Depo sunucusu", null)];

function open(path: string, opts: { role?: PortalRole; detail?: UpdateWaveDetail; extra?: Record<string, Handler> } = {}) {
  const d = opts.detail ?? wave();
  const list: UpdateWave[] = [
    { ...d, sayac: tally({ uyariAcik: true, hata: 2 }) },
    { id: OLD_WAVE_ID, kanalKodu: "genel", surum: "2.11.4", oncekiSurum: "2.11.0", asama: 3, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-21T08:00:00.000Z", yururlukte: false, sayac: tally() },
  ];
  const changed = { dalga: { ...d, asama: d.asama + 1 }, kayit: d.gecmis[0], zil: 1 };
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(opts.role ?? "SATICI_OPERATOR") }),
      "GET /guncelleme-dalgalari": () => ({ data: list }),
      [`GET /guncelleme-dalgalari/${WAVE_ID}`]: () => ({ data: d }),
      "GET /filo": () => ({ data: FLEET }),
      [`POST /guncelleme-dalgalari/${WAVE_ID}/ilerlet`]: () => ({ data: changed }),
      [`POST /guncelleme-dalgalari/${WAVE_ID}/geri-cek`]: () => ({ data: { ...changed, dalga: { ...d, asama: 0 }, zil: 2 } }),
      // Başarılı doğuş ayrıntıya gezinir; bu test yalnız gövdeyi ölçer.
      "POST /guncelleme-dalgalari": () => ({ status: 400, code: "GOVDE_GECERSIZ", message: "ölçüm" }),
      ...opts.extra,
    },
  });
}

describe("güncelleme dalgaları listesi", () => {
  it("sürüm × grup satırı: aşama, sayaçlar, uyarı rozeti, yürürlük; menüde bağlantı", async () => {
    open("/guncelleme-dalgalari");
    const link = await screen.findByRole("link", { name: "2.11.4 → 2.12.0" });
    expect(link).toHaveAttribute("href", `/guncelleme-dalgalari/${WAVE_ID}`);
    const row = link.closest("tr")!;
    expect(within(row).getByText("Aşama 2 · %50")).toBeInTheDocument();
    expect(within(row).getByText("Uyarı · 2 sorunlu")).toBeInTheDocument();
    expect(within(row).getByText("Yürürlükte")).toBeInTheDocument();
    expect(within(row).getByText("2 / 3")).toBeInTheDocument();
    const old = screen.getByRole("link", { name: "2.11.0 → 2.11.4" }).closest("tr")!;
    expect(within(old).getByText("Aşama 3 · hepsi")).toBeInTheDocument();
    expect(within(old).getByText("Yerini yeni dalgaya bıraktı")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Ana menü" })).getByRole("link", { name: "Güncelleme dalgaları" })).toBeInTheDocument();
  });

  it("izni olmayan rol (guncelleme:dalga yok) yazma düğmelerini görmez", async () => {
    open("/guncelleme-dalgalari", { role: "BAYI" });
    await screen.findByRole("link", { name: "2.11.4 → 2.12.0" });
    expect(screen.queryByRole("button", { name: "Yeni dalga" })).toBeNull();
  });

  it("yeni dalga: sürüm biçimi + sebep zorunlu; boş önceki sürüm gövdeye girmez; işlem kimliği var", async () => {
    const user = userEvent.setup();
    const { calls } = open("/guncelleme-dalgalari");
    await user.click(await screen.findByRole("button", { name: "Yeni dalga" }));
    const dialog = await screen.findByRole("dialog", { name: "Yeni güncelleme dalgası" });
    const submit = within(dialog).getByRole("button", { name: "Dalgayı aç" });
    await user.type(within(dialog).getByLabelText("Yayılacak backend sürümü"), "2.13");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Yeni sürüm");
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Yayılacak backend sürümü"), ".0");
    expect(submit).toBeEnabled();
    await user.click(submit);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("/guncelleme-dalgalari");
    expect(w[0]!.body).toMatchObject({ kanalKodu: "genel", surum: "2.13.0", sebep: "Yeni sürüm" });
    expect(w[0]!.body).not.toHaveProperty("oncekiSurum");
    expect(typeof w[0]!.body!.clientToken).toBe("string");
  });
});

describe("güncelleme dalgası ayrıntısı", () => {
  it("sayaçlar, kurulum adları, insan sabitlemesi ile dalga tavanı ayrı sütun, karar geçmişi", async () => {
    open(`/guncelleme-dalgalari/${WAVE_ID}`);
    const boya = await screen.findByRole("link", { name: "Örnek Tekstil › Ana tesis › Boya sunucusu" });
    const row = boya.closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    const headers = within(row.closest("table")!).getAllByRole("columnheader").map((h) => h.textContent);
    const pinCol = headers.indexOf("İnsan sabitlemesi");
    const ceilCol = headers.indexOf("Dalga tavanı");
    expect(pinCol).toBeGreaterThan(0);
    expect(ceilCol).toBeGreaterThan(pinCol);
    expect(cells[pinCol]).toBe("2.11.9");
    expect(cells[ceilCol]).toBe("2.12.0");
    const depo = screen.getByRole("link", { name: /Depo sunucusu/ }).closest("tr")!;
    const depoCells = within(depo).getAllByRole("cell").map((c) => c.textContent);
    expect(depoCells[pinCol]).toBe("Yok");
    expect(depoCells[ceilCol]).toBe("2.11.4");
    expect(screen.getByText("Uyarıya rağmen")).toBeInTheDocument();
    expect(screen.getByText("Kanarya temiz")).toBeInTheDocument();
    expect(screen.getByText("Dalga açıldı")).toBeInTheDocument();
    expect(screen.getByText("1 · %10 → 2 · %50")).toBeInTheDocument();
  });

  it("izni olmayan rol ilerlet / geri çek düğmelerini görmez", async () => {
    open(`/guncelleme-dalgalari/${WAVE_ID}`, { role: "BAYI" });
    await screen.findByText("Aşama başına sonuçlar");
    expect(screen.queryByRole("button", { name: "Sonraki aşamaya geç" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aşamayı geri çek" })).toBeNull();
  });

  it("ilerlet (ek onay gerekmiyor): giren kurulum adıyla; gövdede beklenen aşama + sebep, onay YOK", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/guncelleme-dalgalari/${WAVE_ID}`);
    await user.click(await screen.findByRole("button", { name: "Sonraki aşamaya geç" }));
    const dialog = await screen.findByRole("dialog", { name: /Sonraki aşamaya geç: 2 · %50 → 3 · hepsi/ });
    expect(within(dialog).getByText("Örnek Tekstil › Ana tesis › Depo sunucusu")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Ek onay gerekiyor/)).toBeNull();
    const submit = within(dialog).getByRole("button", { name: "İlerlet" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Öncüler temiz");
    await user.click(submit);
    await screen.findByText(/Tavanı değişen 1 kuruluma hemen haber verildi/);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.body).toMatchObject({ beklenenAsama: 2, sebep: "Öncüler temiz" });
    expect(w[0]!.body).not.toHaveProperty("onay");
  });

  it("ilerlet (sayaç ek onay istiyor): uyarı + açık onay kutusu işaretlenmeden düğme kapalı; gövdede onay: true", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/guncelleme-dalgalari/${WAVE_ID}`, { detail: wave({ sayac: tally({ uyariAcik: true, hata: 2, ilerletmeEkOnayIster: true }) }) });
    await user.click(await screen.findByRole("button", { name: "Sonraki aşamaya geç" }));
    const dialog = await screen.findByRole("dialog", { name: /Sonraki aşamaya geç/ });
    expect(within(dialog).getByText(/Sorun eşiği aşıldı: 2 kurulum/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Hatalar donanım kaynaklı");
    const submit = within(dialog).getByRole("button", { name: "Onaylıyorum, ilerlet" });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Uyarıyı okudum/ }));
    await user.click(submit);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.body).toMatchObject({ beklenenAsama: 2, onay: true });
  });

  it("sunucu 400 IKINCI_ONAY_GEREKLI: onay adımı açılır, yeni deneme YENİ işlem kimliğiyle onay: true taşır", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/guncelleme-dalgalari/${WAVE_ID}`, {
      extra: {
        [`POST /guncelleme-dalgalari/${WAVE_ID}/ilerlet`]: (req) =>
          req.body?.onay === true
            ? { data: { dalga: { ...wave(), asama: 3 }, kayit: wave().gecmis[0], zil: 1 } }
            : { status: 400, code: "IKINCI_ONAY_GEREKLI", message: "Sonraki aşamaya geçmek ek onay ister: aşamadakilerin yalnız %40'i sonuç bildirdi. Gerekçeyi yazıp onaylayın" },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Sonraki aşamaya geç" }));
    const dialog = await screen.findByRole("dialog", { name: /Sonraki aşamaya geç/ });
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Devam");
    await user.click(within(dialog).getByRole("button", { name: "İlerlet" }));
    expect(await within(dialog).findByText(/yalnız %40'i sonuç bildirdi/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Onaylıyorum, ilerlet" });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole("checkbox", { name: /Uyarıyı okudum/ }));
    await user.click(submit);
    await screen.findByText(/Tavanı değişen 1 kuruluma/);
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[0]!.body).not.toHaveProperty("onay");
    expect(w[1]!.body).toMatchObject({ onay: true, beklenenAsama: 2, sebep: "Devam" });
    expect(w[1]!.body!.clientToken).not.toBe(w[0]!.body!.clientToken);
  });

  it("belirsiz hata (5xx) sonrası yineleme AYNI işlem kimliğiyle gider", async () => {
    const user = userEvent.setup();
    let n = 0;
    const { calls } = open(`/guncelleme-dalgalari/${WAVE_ID}`, {
      extra: {
        [`POST /guncelleme-dalgalari/${WAVE_ID}/ilerlet`]: () =>
          ++n === 1 ? { status: 503, code: "SUNUCU_HATASI", message: "Geçici hata" } : { data: { dalga: { ...wave(), asama: 3 }, kayit: wave().gecmis[0], zil: 1 } },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Sonraki aşamaya geç" }));
    const dialog = await screen.findByRole("dialog", { name: /Sonraki aşamaya geç/ });
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Devam");
    await user.click(within(dialog).getByRole("button", { name: "İlerlet" }));
    await within(dialog).findByText("Geçici hata");
    await user.click(within(dialog).getByRole("button", { name: "İlerlet" }));
    await screen.findByText(/Tavanı değişen 1 kuruluma/);
    const w = writes(calls);
    expect(w).toHaveLength(2);
    expect(w[1]!.body!.clientToken).toBe(w[0]!.body!.clientToken);
  });

  it("geri çek: hedef aşama seçilir (0 = durdur), dalgadan çıkan her kurulum adıyla ve durumuyla listelenir, sebep zorunlu", async () => {
    const user = userEvent.setup();
    const { calls } = open(`/guncelleme-dalgalari/${WAVE_ID}`);
    await user.click(await screen.findByRole("button", { name: "Aşamayı geri çek" }));
    const dialog = await screen.findByRole("dialog", { name: /Aşamayı geri çek/ });
    // Varsayılan bir adım: 2 → 1 yalnız aşama 2'de girenleri çıkarır.
    expect(within(dialog).getByText("Dalgadan çıkan kurulumlar (1)")).toBeInTheDocument();
    expect(within(dialog).getByText("Örnek Tekstil › Ana tesis › Boya sunucusu")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Yeni aşama"), "0");
    expect(within(dialog).getByText("Dalgadan çıkan kurulumlar (2)")).toBeInTheDocument();
    expect(within(dialog).getByText("Örnek Tekstil › Ana tesis › Dokuma sunucusu")).toBeInTheDocument();
    expect(within(dialog).getByText(/zaten güncellendi, geri inmez/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Aşamayı geri çek" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Geri dönüşler arttı");
    await user.click(submit);
    await screen.findByText(/Aşama 0 · durdu oldu/);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/guncelleme-dalgalari/${WAVE_ID}/geri-cek`);
    expect(w[0]!.body).toMatchObject({ beklenenAsama: 2, hedefAsama: 0, sebep: "Geri dönüşler arttı" });
  });

  it("aşama 0'da geri çek kapalı", async () => {
    open(`/guncelleme-dalgalari/${WAVE_ID}`, { detail: wave({ asama: 0 }) });
    expect(await screen.findByRole("button", { name: "Aşamayı geri çek" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sonraki aşamaya geç" })).toBeEnabled();
  });

  it("aşama 3'te (hepsi) ilerlet kapalı", async () => {
    open(`/guncelleme-dalgalari/${WAVE_ID}`, { detail: wave({ asama: 3 }) });
    expect(await screen.findByRole("button", { name: "Sonraki aşamaya geç" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Aşamayı geri çek" })).toBeEnabled();
  });
});
