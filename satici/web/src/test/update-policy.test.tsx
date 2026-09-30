// GÜNCELLEME POLİTİKASI ve FİLO (Dağıtım v2) — kurulumun Güncelleme sekmesi politikayı, dilimi, raporu ve
// geçmişi gösterir; değişiklik sebep ister, otomatik kip pencere ister (sunucu aynı kuralı protokol şemasıyla
// uygular), gövde gün listesini sıralı yollar. Filo sayfası "geride"yi yalnız sunucunun hükmünden çizer.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { draftProblem, policyBody } from "../portal/update/UpdatePanel";
import { policyText, windowText } from "../portal/update/labels";
import type { PortalRole } from "../shared/permissions";
import type { FleetRow, InstallationDetail, InstallationUpdateView } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const VIEW: InstallationUpdateView = {
  politika: { kip: "ONAYLI", pencere: null, hedefSurum: null },
  saatDilimi: "Europe/Istanbul",
  saatDilimiBildirildi: false,
  rapor: null,
  raporZamani: null,
  gecmis: [],
};

function openUpdateTab(role: PortalRole, view: InstallationUpdateView = VIEW, detail: InstallationDetail = installationDetail(), extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}/guncelleme`]: () => ({ data: view }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
}

async function goToTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Güncelleme" }));
}

describe("saf yardımcılar", () => {
  it("gövde gün listesini sıralar, boş sabitleme null olur; pencere kapalıyken pencere null", () => {
    const base = { mode: "OTOMATIK" as const, windowOn: true, start: "23:00", end: "03:00", days: [5, 1, 3], target: " " };
    expect(policyBody(base)).toEqual({ kip: "OTOMATIK", pencere: { baslangic: "23:00", bitis: "03:00", gunler: [1, 3, 5] }, hedefSurum: null });
    expect(policyBody({ ...base, mode: "ONAYLI", windowOn: false, target: "2.14.0" })).toEqual({ kip: "ONAYLI", pencere: null, hedefSurum: "2.14.0" });
  });

  it("ön doğrulama: otomatik pencere ister · saat biçimi · başlangıç=bitiş · gün yok · sürüm biçimi", () => {
    const ok = { mode: "OTOMATIK" as const, windowOn: true, start: "02:00", end: "24:00", days: [1], target: "" };
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, windowOn: false })).toMatch(/pencere/);
    expect(draftProblem({ ...ok, start: "24:00" })).toMatch(/Başlangıç/);
    expect(draftProblem({ ...ok, end: "5:00" })).toMatch(/Bitiş/);
    expect(draftProblem({ ...ok, end: "02:00" })).toMatch(/aynı/);
    expect(draftProblem({ ...ok, days: [] })).toMatch(/gün/);
    expect(draftProblem({ ...ok, target: "v2" })).toMatch(/sürüm/);
    expect(draftProblem({ ...ok, mode: "DONDUR", windowOn: false })).toBeNull();
  });

  it("pencere metni gece yarısını aşan pencereyi ve her günü söyler", () => {
    expect(windowText({ baslangic: "23:00", bitis: "03:00", gunler: [1, 3] })).toBe("Pzt, Çar · 23:00–03:00 (ertesi gün)");
    expect(windowText({ baslangic: "02:00", bitis: "24:00", gunler: [1, 2, 3, 4, 5, 6, 7] }, "Europe/Berlin")).toBe("Her gün · 02:00–24:00 · Europe/Berlin");
    expect(policyText({ kip: "DONDUR", pencere: null, hedefSurum: "2.14.0" })).toBe("Dondurulmuş · sabit 2.14.0");
  });
});

describe("kurulum → Güncelleme sekmesi", () => {
  it("politika · varsayılan dilim notu · rapor yok · K1 uyarısı", async () => {
    const user = userEvent.setup();
    const detail = installationDetail({ yaptirim: { kademe: "K1", mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: true } });
    openUpdateTab("SATICI_OPERATOR", VIEW, detail);
    await goToTab(user);
    expect(await screen.findByText("Onaylı (fabrikada onayla)")).toBeInTheDocument();
    expect(screen.getByText(/varsayılan — fabrika henüz bildirmedi/)).toBeInTheDocument();
    expect(screen.getByText(/Güncelleyici henüz rapor vermedi/)).toBeInTheDocument();
    expect(screen.getByText(/K1 güncelleme dondurma yürürlükte/)).toBeInTheDocument();
  });

  it("rapor ve geçmiş: güncelleyici durumu, bekleyen karar, son deneme, politika satırı", async () => {
    const user = userEvent.setup();
    const view: InstallationUpdateView = {
      ...VIEW,
      politika: { kip: "OTOMATIK", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [6, 7] }, hedefSurum: null },
      saatDilimiBildirildi: true,
      rapor: {
        guncelleyici: { durum: "CALISIYOR", surum: "1.0.0" },
        bekleyen: { surum: "2.15.0", karar: "PENCERE_BEKLIYOR", neden: "PENCERE" },
        son: { kayitId: "a", hedefSurum: "2.14.0", kaynakSurum: "2.13.1", sonuc: "GERI_DONDU", kod: "SAGLIK_HATASI", baslangic: "2026-09-28T23:00:00.000Z", bitis: "2026-09-28T23:10:00.000Z", veriGeriYuklendi: true },
      },
      raporZamani: "2026-09-29T08:00:00.000Z",
      gecmis: [
        { id: "g2", olay: "GUNCELLEME_GERI_DONDU", ayrinti: { kaynakSurum: "2.13.1", hedefSurum: "2.14.0", kod: "SAGLIK_HATASI", veriGeriYuklendi: true }, yapan: "guncelleyici", createdAt: "2026-09-29T08:00:00.000Z" },
        {
          id: "g1",
          olay: "GUNCELLEME_POLITIKASI",
          ayrinti: { onceki: { kip: "ONAYLI", pencere: null, hedefSurum: null }, yeni: { kip: "OTOMATIK", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [6, 7] }, hedefSurum: null }, sebep: "Hafta sonu bakım" },
          yapan: "portal:deneme",
          createdAt: "2026-09-28T08:00:00.000Z",
        },
      ],
    };
    openUpdateTab("SATICI_OPERATOR", view);
    await goToTab(user);
    expect(await screen.findByText("Europe/Istanbul (fabrika bildirdi)")).toBeInTheDocument();
    expect(screen.getByText("Çalışıyor · 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("2.15.0 · Pencere bekliyor (Pencere açık)")).toBeInTheDocument();
    expect(screen.getByText(/Sağlık denetimi başarısız/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("2.13.1 → 2.14.0 · Sağlık denetimi başarısız · veri yedekten geri yüklendi")).toBeInTheDocument();
    expect(screen.getByText(/Onaylı \(fabrikada onayla\) → Otomatik \(pencerede\) · Cmt, Paz · 02:00–05:00 — Hafta sonu bakım/)).toBeInTheDocument();
  });

  it("değiştir: otomatik kip pencere olmadan kaydedilmez; pencere + gün + sebeple sıralı gövde gider", async () => {
    const user = userEvent.setup();
    const { calls } = openUpdateTab("SATICI_OPERATOR", VIEW, installationDetail(), {
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/guncelleme-politikasi`]: () => ({ data: { kurulumId: INSTALLATION_DB_ID, politika: {}, degisti: true } }),
    });
    await goToTab(user);
    await user.click(await screen.findByRole("button", { name: "Değiştir…" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Kaydet" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /^Kip/ }), "OTOMATIK");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Gece penceresi");
    expect(within(dialog).getByText("Otomatik kip bir güncelleme penceresi ister.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByLabelText("Güncelleme penceresi (fabrika saatiyle)"));
    // Pencere açılınca her gün seçili gelir; hafta içini çıkar → yalnız hafta sonu kalır.
    for (const d of ["Pzt", "Sal", "Çar", "Per", "Cum"]) await user.click(within(dialog).getByLabelText(d));
    expect(save).toBeEnabled();
    await user.clear(within(dialog).getByLabelText(/^Sabitlenen sürüm/));
    await user.type(within(dialog).getByLabelText(/^Sabitlenen sürüm/), "v2");
    expect(save).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/^Sabitlenen sürüm/));
    await user.click(save);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/guncelleme-politikasi`);
    expect(w[0]!.body).toMatchObject({ kip: "OTOMATIK", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [6, 7] }, hedefSurum: null, sebep: "Gece penceresi" });
    expect(typeof w[0]!.body!.clientToken).toBe("string");
  });

  it("değişmeyen politika gönderilmez (düğme kapalı, neden yazılı)", async () => {
    const user = userEvent.setup();
    openUpdateTab("SATICI_YONETICI");
    await goToTab(user);
    await user.click(await screen.findByRole("button", { name: "Değiştir…" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Sebep/), "Deneme");
    expect(within(dialog).getByText("Politika değişmedi.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Kaydet" })).toBeDisabled();
  });

  it("iptal edilmiş kurulumda politika değiştirilemez", async () => {
    const user = userEvent.setup();
    const base = installationDetail();
    openUpdateTab("SATICI_YONETICI", VIEW, { ...base, kurulum: { ...base.kurulum, durum: "IPTAL" } });
    await goToTab(user);
    expect(await screen.findByText("Onaylı (fabrikada onayla)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Değiştir…" })).toBeNull();
  });
});

describe("Filo sayfası", () => {
  const row = (over: Partial<FleetRow>): FleetRow => ({
    id: INSTALLATION_DB_ID,
    kurulumId: "9e8d7c6b-0000-4000-8000-00000000abcd",
    ad: "Merkez sunucu",
    musteri: "Örnek Tekstil",
    tesis: "Ana tesis",
    kanal: "testfabrika",
    sinif: "URETIM",
    durum: "ETKIN",
    sonYoklama: "2026-09-29T08:00:00.000Z",
    kuruluSurum: "2.13.1",
    kanalSurumu: { surum: "2.14.0", kaynak: "YAYIN" },
    geride: true,
    politika: { kip: "ONAYLI", pencere: null, hedefSurum: null },
    rapor: null,
    raporZamani: null,
    sonSonuc: null,
    ...over,
  });

  it("geride/güncel/bilinmiyor sunucunun hükmünden; özet şeridi aynı satırlardan; kurulum bağlantısı", async () => {
    renderApp({
      base: "/portal/api",
      routes: PORTAL_ROUTES,
      path: "/filo",
      handlers: {
        "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
        "GET /filo": () => ({
          data: [
            row({}),
            row({ id: "b", ad: "Yedek", geride: false, kuruluSurum: "2.14.0", sonSonuc: { olay: "GUNCELLEME_BASARILI", ayrinti: null, createdAt: "2026-09-29T07:00:00.000Z" } }),
            row({ id: "c", ad: "Eski", geride: null, kuruluSurum: null, kanalSurumu: { surum: "2.14.0", kaynak: "KANAL_KAYDI" }, rapor: { guncelleyici: { durum: "YOK", surum: null }, bekleyen: null, son: null } }),
          ],
        }),
      },
    });
    expect(await screen.findByText("3 kurulum · 1 güncel · 1 geride · 1 bilinmiyor")).toBeInTheDocument();
    expect(screen.getByText("Geride")).toBeInTheDocument();
    expect(screen.getByText("Güncel")).toBeInTheDocument();
    expect(screen.getByText("Bilinmiyor")).toBeInTheDocument();
    expect(screen.getByText("2.14.0 (kanal kaydı)")).toBeInTheDocument();
    expect(screen.getByText("Kurulu değil")).toBeInTheDocument();
    expect(screen.getByText("Güncelleme başarılı")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Örnek Tekstil › Ana tesis › Merkez sunucu" })).toHaveAttribute("href", `/kurulumlar/${INSTALLATION_DB_ID}`);
    expect(screen.getByRole("link", { name: "Filo" })).toBeInTheDocument();
  });
});
