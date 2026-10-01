// ÖDENMİŞ TARİH (lisans v2) — kurulum künyesinin Lisans sekmesi: P ve kaynağı, fabrikada P modeli var/yok, son
// alışveriş, bant tahmini; çevrimdışı uzatma dosyası SEBEPSİZ yalnız işlem kimliğiyle gider (sunucu gövdesi KATI) ve
// yanıtın imzalı içeriği AYNEN dosyaya/metne konur. Kopya ve taşıma sekmesi yerel müdahale nedenlerini, kira tablosu
// kapanış kirasının nedenini ekran adıyla gösterir. Bayi görünümünde (blok yok) panel çizilmez.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { fmtDate } from "../shared/format";
import type { PortalRole } from "../shared/permissions";
import type { ExtensionFile, InstallationDetail, PaidThroughView } from "../shared/types";
import { CATALOG, INSTALLATION_DB_ID, installationDetail } from "./fixtures";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const P: PaidThroughView = {
  tarih: "2026-12-31T21:00:00.000Z",
  tur: "SOZLESME_SONU",
  pModeli: true,
  sonAlisveris: "2026-10-01T09:00:00.000Z",
  internetVar: true,
  bantGorunurTahmini: true,
};

function open(role: PortalRole, detail: InstallationDetail, extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: `/kurulumlar/${INSTALLATION_DB_ID}`,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      [`GET /kurulumlar/${INSTALLATION_DB_ID}`]: () => ({ data: detail }),
      "GET /katalog": () => ({ data: CATALOG }),
      "GET /kanallar": () => ({ status: 404, code: "BULUNAMADI" }),
      ...extra,
    },
  });
}

describe("ödenmiş tarih paneli", () => {
  it("P (kaynağıyla), P modeli, son alışveriş ve bant tahmini çizilir", async () => {
    open("SATICI_OPERATOR", installationDetail({ odenmisTarih: P }));
    const panel = (await screen.findByText("Ödenmiş tarih (internetsiz çalışma)")).closest("section")!;
    expect(within(panel).getByText(`${fmtDate(P.tarih)} — sözleşme sonu`)).toBeInTheDocument();
    expect(within(panel).getByText(/Evet — internetsiz P'ye dek/)).toBeInTheDocument();
    expect(within(panel).getByText("Görünür")).toBeInTheDocument();
  });

  it("P modeli yoksa eski çapa uyarısı; süresiz P 'Süresiz'", async () => {
    open("SATICI_OPERATOR", installationDetail({ odenmisTarih: { ...P, tarih: null, tur: "SURESIZ", pModeli: false, bantGorunurTahmini: false } }));
    const panel = (await screen.findByText("Ödenmiş tarih (internetsiz çalışma)")).closest("section")!;
    expect(within(panel).getByText("Süresiz")).toBeInTheDocument();
    expect(within(panel).getByText(/eski çapa/)).toBeInTheDocument();
  });

  it("blok gelmeyen görünümde (bayi künyesi biçimi) panel çizilmez", async () => {
    open("SATICI_OPERATOR", installationDetail());
    await screen.findByRole("tab", { name: "Lisans" });
    expect(screen.queryByText("Ödenmiş tarih (internetsiz çalışma)")).toBeNull();
  });

  it("⭐ uzatma dosyası: sebepsiz, yalnız işlem kimliği; imzalı içerik AYNEN gösterilir", async () => {
    const user = userEvent.setup();
    const file: ExtensionFile = {
      dosya: { v: 1, hak: "h.e.s", kira: "k.e.s", indirmeBelirtecleri: [], sunucuSaati: "2026-10-01T10:00:00.000Z" },
      dosyaAdi: "lisans-TKS-2026-0042-20261001.json",
      kiraId: "5b0c6a4e-9999-4000-8000-000000000009",
      odenmisTarih: P.tarih,
    };
    const { calls } = open("SATICI_OPERATOR", installationDetail({ odenmisTarih: P }), {
      [`POST /kurulumlar/${INSTALLATION_DB_ID}/uzatma-dosyasi`]: () => ({ data: file }),
    });
    await user.click(await screen.findByRole("button", { name: "Çevrimdışı uzatma dosyası…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/^Sebep/)).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Dosyayı üret" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kurulumlar/${INSTALLATION_DB_ID}/uzatma-dosyasi`);
    expect(Object.keys(w[0]!.body ?? {})).toEqual(["clientToken"]);
    const ready = await screen.findByRole("dialog", { name: "Çevrimdışı uzatma dosyası hazır" });
    expect(within(ready).getByText(file.dosyaAdi)).toBeInTheDocument();
    expect((within(ready).getByLabelText("Dosya içeriği") as HTMLTextAreaElement).value).toBe(JSON.stringify(file.dosya));
  });

  it("✓K uzatma dosyası düğmesi etkinleşmemiş kurulumda yok", async () => {
    const d = installationDetail({ odenmisTarih: P });
    open("SATICI_OPERATOR", { ...d, kurulum: { ...d.kurulum, durum: "ETKINLESMEDI" } });
    await screen.findByText("Ödenmiş tarih (internetsiz çalışma)");
    expect(screen.queryByRole("button", { name: "Çevrimdışı uzatma dosyası…" })).toBeNull();
  });
});

describe("kopya ve kira sekmeleri — lisans v2 etiketleri", () => {
  it("YEREL_MUDAHALE nedenleri ekran adıyla; kapanış kirası nedeniyle", async () => {
    const user = userEvent.setup();
    open(
      "SATICI_OPERATOR",
      installationDetail({
        kopyaUyarilari: [
          {
            id: "5b0c6a4e-7777-4000-8000-000000000007",
            kurulumId: INSTALLATION_DB_ID,
            tur: "YEREL_MUDAHALE",
            durum: "ACIK",
            ilkGorulme: "2026-10-01T09:00:00.000Z",
            sonGorulme: "2026-10-01T10:00:00.000Z",
            gorulmeSayisi: 2,
            redZamani: null,
            kapanisZamani: null,
            kapatan: null,
            ayrinti: { nedenler: ["SIRA_SIFIRLANDI", "LISANS_IZI_KAYIP"], sayac: { SIRA_SIFIRLANDI: 2 } },
          },
        ],
        kiralar: [
          {
            id: "5b0c6a4e-8888-4000-8000-000000000008",
            karar: "KAPANIS",
            kapanisNedeni: "KOPYA",
            oncekiKiraId: null,
            anahtarKimligi: "kurulum-abc",
            hakSurum: 1,
            verilis: "2026-10-01T10:00:00.000Z",
            bitis: "2026-10-31T10:00:00.000Z",
            createdAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      }),
    );
    await user.click(await screen.findByRole("tab", { name: /Kopya ve taşıma/ }));
    expect(screen.getByText("Yerel müdahale şüphesi (lisans izleri)")).toBeInTheDocument();
    expect(screen.getByText("Durum kaydı sıfırlandı (izler silinmiş) ×2 · Lisans izi kayıp")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Sağlık ve kira" }));
    expect(screen.getByText("Kapanış kirası — kopya (çatal)")).toBeInTheDocument();
  });
});
