import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { kit, kitBox, kitRequested, renderKitPano, resetKit } from "./pano-test-kit";
import { cleanBoxOptions, DEFAULT_BOX_OPTIONS, nextBoxOptions } from "./box-options";

// Kutuya özgü ayarlar (`dashboard.boxOptions`): varsayılan = bugünkü görünüm, izinsiz/kapalı veri seçenek olmaz,
// ayar değişimi istek atmaz, bilinmeyen anahtar/değer düşer, varsayılana dön ayarı da siler.
const CATALOG = [kitBox("ajanda", "genis", true, false), kitBox("sonHareketler", "orta", true, false), kitBox("tezgah", "kucuk", true, false)];
const days = Array.from({ length: 30 }, (_, i) => ({ gun: `2026-11-${String(i + 1).padStart(2, "0")}`, alis: 0, isEmri: 0, dokuma: 0, sevk: 0, toplam: 0 }));
const AGENDA = {
  gun: "2026-11-12", ay: "2026-11", kesildi: false, ayGunleri: days,
  isler: {
    alisTeslim: null, // izinsiz → seçenek olmamalı
    isEmriBaslangic: { toplam: 1, kalemler: [{ id: "w1", no: "IE-12", durum: "PLANNED", hedefMetre: 100, zaman: null }] },
    dokumaBaslangic: { toplam: 1, kalemler: [{ id: "d1", no: "DK-12", durum: "PLANNED", kumas: "Tül", planlananMetre: 50, zaman: null }] },
    sevkiyat: { toplam: 0, kalemler: [] },
  },
  planliSevkiyat: { toplam: 1, kalemler: [{ id: "u1", no: "SVK-T", musteri: "Beta", olusturuldu: "2026-11-01T08:00:00.000Z" }] },
};
const mv = (tur: string, no: string) => ({ tur, belgeNo: no, cari: "Alfa", miktar: 10, birim: "m", zaman: "2026-11-12T08:00:00.000Z", hedef: { tur: "order", id: no } });
const MOVES = {
  hareketler: [mv("SIPARIS", "SP-1"), mv("SEVK", "IRS-1"), mv("DOGRUDAN_SEVK", "DS-1"), ...Array.from({ length: 5 }, (_, i) => mv("SIPARIS", `SP-${i + 2}`))],
  turler: ["SIPARIS", "SEVK", "DOGRUDAN_SEVK"],
};
const DATA = { ajanda: AGENDA, sonHareketler: MOVES, tezgah: { toplam: 2, calisan: 1, duran: 0, izlenmeyen: 1, issiz: 1, suAnYuzde: 50 } };
const opts = () => (kit.prefs.dashboard as { boxOptions?: Record<string, unknown> } | undefined)?.boxOptions;

async function openSettings(box: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `${box} kutusu seçenekleri` }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Ayarlar/ }));
  return within(await screen.findByRole("dialog", { name: `${box} ayarları` }));
}

beforeEach(() => resetKit(CATALOG, DATA));

describe("Pano — kutu ayarları", () => {
  it("varsayılan = bugünkü görünüm: takvim Pzt ile başlar, bütün türler ve 8 hareket", async () => {
    await renderKitPano();
    await screen.findByText("IE-12");
    expect(screen.getByText("DK-12")).toBeTruthy();
    expect(screen.getByText("SVK-T")).toBeTruthy();
    expect(screen.getAllByText("Pzt")[0]).toBeTruthy();
    expect(screen.getByText("SP-6")).toBeTruthy();
    expect(screen.getByText("DS-1")).toBeTruthy();
    expect(cleanBoxOptions(undefined)).toEqual(DEFAULT_BOX_OPTIONS);
  });

  it("ayarı olmayan kutuda ⋯ menüsünde Ayarlar yok", async () => {
    await renderKitPano();
    await screen.findByText("Tezgâh salonu");
    fireEvent.keyDown(screen.getByRole("button", { name: "tezgah kutusu seçenekleri" }), { key: "Enter" });
    await screen.findByRole("menuitem", { name: /Panodan kaldır/ });
    expect(screen.queryByRole("menuitem", { name: /Ayarlar/ })).toBeNull();
  });

  it("izinsiz (null) tür seçenekte çıkmaz; ayar değişimi istek atmaz, gösterimi süzer", async () => {
    await renderKitPano();
    await screen.findByText("IE-12");
    const panel = await openSettings("ajanda");
    expect(panel.queryByText("Alış teslimleri")).toBeNull();
    expect(panel.getByText("Dokuma başlangıçları")).toBeTruthy();
    fireEvent.click(panel.getByRole("checkbox", { name: "Dokuma başlangıçları" }));
    fireEvent.click(panel.getByRole("checkbox", { name: "Tarihsiz sevkiyat listesi" }));
    fireEvent.click(panel.getByRole("radio", { name: "Paz" }));
    await waitFor(() => expect(screen.queryByText("DK-12")).toBeNull());
    expect(screen.queryByText("SVK-T")).toBeNull();
    expect(screen.getByText("IE-12")).toBeTruthy();
    expect(opts()).toEqual({ ajanda: { hidden: ["dokuma", "tarihsiz"], calendar: true, weekStart: "sun" } });
    fireEvent.click(panel.getByRole("checkbox", { name: "Takvimi göster" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Önceki ay" })).toBeNull());
    expect(kitRequested()).toHaveLength(1);
  });

  it("son hareketler: doğrudan sevk Sevk grubunda; izinsiz tür seçenek değil; satır sayısı 5", async () => {
    await renderKitPano();
    await screen.findByText("SP-6");
    const panel = await openSettings("sonHareketler");
    expect(panel.getAllByRole("checkbox").map((c) => c.closest("label")?.textContent)).toEqual(["Sipariş", "Sevk"]);
    fireEvent.click(panel.getByRole("checkbox", { name: "Sevk" }));
    await waitFor(() => expect(screen.queryByText("DS-1")).toBeNull());
    expect(screen.queryByText("IRS-1")).toBeNull();
    // Son açık tür kapatılamaz.
    expect(panel.getByRole("checkbox", { name: "Sipariş" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(panel.getByRole("radio", { name: "5" }));
    await waitFor(() => expect(screen.queryByText("SP-6")).toBeNull());
    expect(screen.getByText("SP-5")).toBeTruthy();
    expect(kitRequested()).toHaveLength(1);
  });

  it("bilinmeyen anahtar/değer sessizce düşer; varsayılana eşit ayar kayda yazılmaz", () => {
    const c = cleanBoxOptions({ eskiKutu: { a: 1 }, ajanda: { hidden: ["alis", "uydurma"], weekStart: "cuma", fazla: true }, enCok: { rows: 9 } });
    expect(c.ajanda).toEqual({ hidden: ["alis"], calendar: true, weekStart: "mon" });
    expect(c.enCok).toEqual(DEFAULT_BOX_OPTIONS.enCok);
    expect(cleanBoxOptions([1, 2])).toEqual(DEFAULT_BOX_OPTIONS);
    expect(nextBoxOptions({ eskiKutu: 1 }, "dagilim", { chart: "bars", slices: 3 })).toEqual({ dagilim: { chart: "bars", slices: 3 } });
    expect(nextBoxOptions({ dagilim: { chart: "bars" } }, "dagilim", DEFAULT_BOX_OPTIONS.dagilim)).toBeUndefined();
  });

  it("varsayılana dön kutu ayarlarını da siler", async () => {
    resetKit(CATALOG, DATA, { dashboard: { donem: "bugun", boxOptions: { ajanda: { hidden: ["dokuma"] } } } });
    await renderKitPano();
    await screen.findByText("IE-12");
    expect(screen.queryByText("DK-12")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Panoyu düzenle/ }));
    fireEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    expect(opts()).toBeUndefined();
  });
});
