// =============================================================================
// Analiz kartı (R3-ANALIZ; plan §4.7) — istemci kanıt dili ÜRETMEZ, sunucunun cümlesini basar
// =============================================================================
// §1 örneklem uyarısı varken sonuç cümlesi çizilmez, sarı uyarı çizilir · §2 sabit "İlişki, nedeni
// göstermez." notu HER kartta (sonuç / uyarı / veri yok) · §3 karıştırıcı düğmesi doğru önizlemeyi
// açar (tezgah küçük çoklu + tezgah × vardiya tablosu), iplik partisi kırılımı yoksa devre dışı ·
// §4 ısı haritası yalnız yeniden dizer · §5 oluşturucu: sayım ölçüsünde maruziyet zorunlu ·
// §6 kaynak taraması: analiz klasöründe olasılık/istatistik hesabı ve kanıt sözcüğü YOK.
// NEGATİF SONDALAR (2026-10-25, md5 ile geri alındı): sabit not kaldırıldı → 3 ❌ (§2) ·
// karta `Math.exp` ile olasılık hesabı eklendi → 1 ❌ (§6) · uyarı dalı kaldırıldı → 1 ❌ (§1).
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { CatalogCube, SemanticResultLite } from "../custom/custom-api";
import type { RaporSunumu } from "../sunum";

const previewMock = vi.fn((_body: unknown) => Promise.resolve({ tanim: { id: null, ad: "x", surumNo: null }, baslik: "x", itibariylaMetni: "", bloklar: [] }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../custom/custom-api", async (orig) => {
  const real = await orig<typeof import("../custom/custom-api")>();
  return { ...real, customReportApi: { ...real.customReportApi, preview: (b: unknown) => previewMock(b) } };
});

import { AnalysisCard } from "./AnalysisCard";
import { CAUSALITY_TEXT, analysisBlockIssue, type AnalysisOutcome } from "./analysis-model";
import { heatmapOf } from "../custom/result-model";

const STRONG = "Gece vardiyasında bulunan hata 1.000 m'de 4,3; diğerlerinde 2,3 — yaklaşık 1,9 katı. Bu fark tesadüf olmayacak kadar büyük (güçlü kanıt; 215 kayıt üzerinden ölçüldü). İlişki, nedeni göstermez.";
const SMALL = "Yalnız 9 kayıt var; karar vermek için en az 30 gerekir. İlişki, nedeni göstermez.";

function sunum(anlati: Array<{ kural: string; metin: string }>): RaporSunumu {
  return {
    anahtar: "analiz/kiKare",
    baslik: "Vardiya × çözgü hatası",
    soru: "Çözgü hatası vardiyaya göre değişiyor mu?",
    donem: { from: "2026-09-25T21:00:00.000Z", to: "2026-10-24T20:59:59.999Z", etiket: "Son 30 gün" },
    anaSayi: { olcu: "kalite.hataAdedi", ad: "Hata", deger: 2.9, birim: "adet" },
    yanSayilar: [],
    anlati: anlati.map((a) => ({ ...a, onem: 1 })),
    grafik: null,
    tablo: { kolonlar: [{ anahtar: "grup", baslik: "Vardiya" }, { anahtar: "oran", baslik: "1.000 m'de", birim: "adet" }], satirlar: [{ grup: "Gece", oran: 4.3 }] },
    tanimlar: [],
    parametreler: [],
    uyarilar: [],
  } as unknown as RaporSunumu;
}

const outcome = (anlati: Array<{ kural: string; metin: string }>, n: number, uyarilar: string[]): AnalysisOutcome => ({
  sunum: sunum(anlati),
  istatistik: { yontem: "kiKare", istatistik: 30.1, n, kanitP: 0.000004, uyarilar },
});

const CUBE: CatalogCube = {
  kimlik: "hata",
  ad: "Kumaş hataları",
  olculer: [{ kimlik: "kalite.hataAdedi", ad: "Hata sayısı", aciklama: "", birim: "adet", boyutlar: null }],
  boyutlar: [
    { kimlik: "vardiya", ad: "Vardiya", tur: "kategori", islecler: ["="] },
    { kimlik: "tezgah", ad: "Tezgah", tur: "kategori", islecler: ["="] },
  ],
};
const BLOCK = { id: "n1", tur: "analiz", yontem: "kiKare", kup: "hata", x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", zaman: { param: "donem" }, suzgec: { combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }] } };
const BODY = { surum: 1, baslik: "Vardiyaya göre çözgü hatası", parametreler: [{ ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" }], bloklar: [BLOCK] };

beforeEach(() => previewMock.mockClear());

describe("§1–§2 sonuç, uyarı, sabit not", () => {
  it("güçlü kanıt: sunucu cümlesi AYNEN + sabit not", () => {
    renderWithProviders(<AnalysisCard analysis={outcome([{ kural: "korelasyon", metin: STRONG }], 215, [])} />);
    expect(screen.getByTestId("analysis-result")).toHaveTextContent(STRONG.replace(` ${CAUSALITY_TEXT}`, ""));
    expect(screen.queryByTestId("analysis-warning")).toBeNull();
    expect(screen.getByTestId("analysis-causality")).toHaveTextContent(CAUSALITY_TEXT);
    expect(screen.getByText("n = 215")).toBeInTheDocument();
    // Sabit not kartta TEK kez: sunucu cümlesinin sonundaki kopya ayıklanır.
    const card = screen.getByTestId("analysis-card").textContent ?? "";
    expect(card.split(CAUSALITY_TEXT)).toHaveLength(2);
    expect(screen.getByTestId("analysis-result")).not.toHaveTextContent(CAUSALITY_TEXT);
  });

  it("⭐ örneklem uyarısı varken sonuç cümlesi çizilmez; sarı uyarı + sabit not", () => {
    renderWithProviders(<AnalysisCard analysis={outcome([{ kural: "korelasyon", metin: STRONG }, { kural: "orneklemUyarisi", metin: SMALL }], 9, ["azOrnek"])} />);
    expect(screen.getByTestId("analysis-warning")).toHaveTextContent(SMALL.replace(` ${CAUSALITY_TEXT}`, ""));
    expect(screen.queryByTestId("analysis-result")).toBeNull();
    expect(screen.queryByText(/güçlü kanıt/)).toBeNull();
    expect(screen.getByTestId("analysis-warning")).not.toHaveTextContent(CAUSALITY_TEXT);
    expect(screen.getByTestId("analysis-causality")).toHaveTextContent(CAUSALITY_TEXT);
  });

  it("veri yok: sunucunun 'kayıt yok' cümlesi + sabit not, görsel yok", () => {
    renderWithProviders(<AnalysisCard analysis={{ sunum: sunum([{ kural: "veriYok", metin: "Bu dönemde kayıt yok." }]), istatistik: null }} />);
    expect(screen.getByTestId("analysis-empty")).toHaveTextContent("Bu dönemde kayıt yok.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("analysis-causality")).toHaveTextContent(CAUSALITY_TEXT);
  });
});

describe("§3 karıştırıcı önerisi", () => {
  it("⭐ 'Tezgaha göre ayrı bak' tezgah küçük çoklusunu aynı süzgeç ve dönemle önizler; iplik partisi devre dışı", async () => {
    renderWithProviders(<AnalysisCard analysis={outcome([{ kural: "korelasyon", metin: STRONG }], 215, [])} block={BLOCK} body={BODY} cubes={[CUBE]} />);
    expect(screen.getByRole("button", { name: /İplik partisine göre ayrı bak/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Tezgaha göre ayrı bak/ }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1));
    const body = previewMock.mock.calls[0]![0] as { parametreler: unknown[]; bloklar: Array<{ tur: string; sorgu: { kup: string; olculer: string[]; boyutlar: string[]; suzgec: unknown; zaman: unknown } }> };
    expect(body.bloklar[0]).toMatchObject({ tur: "varyant", sorgu: { kup: "hata", olculer: ["kalite.hataAdedi"], boyutlar: ["tezgah"], suzgec: BLOCK.suzgec, zaman: { param: "donem" } } });
    expect(body.bloklar[1]).toMatchObject({ tur: "tablo", sorgu: { boyutlar: ["tezgah", "vardiya"] } });
    expect(body.parametreler).toEqual(BODY.parametreler);
  });
});

describe("§4 ısı haritası", () => {
  it("iki kırılım → satır vardiya, sütun saat (sıralı); hücre sunucu sayısı, eksik hücre null", () => {
    const r: SemanticResultLite = {
      olculer: [{ kimlik: "kalite.hataAdedi", ad: "Hata sayısı", birim: "adet" }],
      boyutlar: [{ kimlik: "vardiya", ad: "Vardiya" }, { kimlik: "saat", ad: "Saat" }],
      satirlar: [
        { anahtarlar: { vardiya: { deger: "G", etiket: "Gece" }, saat: { deger: "23", etiket: "23:00" } }, degerler: { "kalite.hataAdedi": 5 } },
        { anahtarlar: { vardiya: { deger: "S", etiket: "Sabah" }, saat: { deger: "07", etiket: "07:00" } }, degerler: { "kalite.hataAdedi": 2 } },
        { anahtarlar: { vardiya: { deger: "G", etiket: "Gece" }, saat: { deger: "02", etiket: "02:00" } }, degerler: { "kalite.hataAdedi": 4 } },
      ],
      toplam: { degerler: {} },
      kiyas: null,
      uyarilar: [],
    };
    const h = heatmapOf(r)!;
    expect(h.tur).toBe("isiHaritasi");
    expect(h.kategoriler).toEqual(["02:00", "07:00", "23:00"]);
    expect(h.seriler).toEqual([
      { ad: "Gece", veri: [4, null, 5] },
      { ad: "Sabah", veri: [null, 2, null] },
    ]);
  });
});

describe("§5 oluşturucu: maruziyet", () => {
  it("sayım ölçüsünde maruziyet yoksa Türkçe neden; seçilince engel kalkar", () => {
    const noExposure = { ...BLOCK, maruziyet: undefined };
    expect(analysisBlockIssue(noExposure, [CUBE])).toMatch(/oranlansın/);
    expect(analysisBlockIssue(BLOCK, [CUBE])).toBeNull();
    expect(analysisBlockIssue({ id: "t", tur: "tablo" }, [CUBE])).toBeNull();
  });
});

describe("§6 istemci hesap yapmaz", () => {
  it("⭐ analiz klasöründe olasılık/istatistik hesabı ve kanıt sözcüğü yok", () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.includes(".test."))) {
      const src = readFileSync(join(dir, f), "utf8");
      if (/Math\.(exp|sqrt|log|pow|abs)\b|simple-statistics|\bgamma\b|studentT|chiSquare|kiKareHesap|güçlü kanıt|kanıt var/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
