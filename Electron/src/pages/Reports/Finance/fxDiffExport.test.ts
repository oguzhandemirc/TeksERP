// =============================================================================
// KUR FARKI — İŞARET + DIŞA AKTARIM BEKÇİSİ
// =============================================================================
// Ölçtüğü altı şey:
//  §1 Excel ↔ PDF kolon eşitliği (tek spec sözleşmesi; `chequeDueExport.test`
//     emsali).
//  §2 EKRAN ⊆ SPEC — `FxDiffPage.tsx`'in `<thead>`'i KAYNAKTAN okunur. Yön TEK
//     TARAFLIDIR ve bilinçli: dosyanın ekrandan fazla kolon taşıması meşrudur,
//     ekranda görünüp dosyada olmayan kolon "aynı rapor, eksik dosya" demektir.
//  §3 ⭐ İŞARET → ROZET eşlemesi (`fxTone`): + lehte, − aleyhte, 0 ve "-0.00"
//     nötr, OKUNAMAYAN değer de nötr (yeşile boyanmaz). Renk sınıfları ayrışık.
//  §4 Satır dönüşümü: tutar/kur hücreleri SAYI, işaret KORUNUR (aleyhte satır
//     dosyada da negatif), sıfır farklı satır dosyada DURUR.
//  §5 ⭐ TOPLAM satırı: FX "Tutar" hücresi BOŞ (farklı dövizler toplanmaz +
//     istemci string tutar toplamaz), TL farkı `summary.netTry`'den — yani
//     istemcide HESAPLANMAZ.
//  §6 Para birimi kırılımının her toplam hücresi backend rakamı.
//
// ⚠️ KÖRLÜK ZEMİNİ: §2'nin regex'i boşa düşerse "ihlal yok" ile "hiçbir şeye
// bakılmadı" AYNI yeşile çıkar — bu yüzden başlık sayısı ve bilinen iki başlık
// ayrıca doğrulanır. Aynı sebeple §5, netTry'yi satır toplamından FARKLI bir
// değere kurar: eşit olsaydı "backend'den mi geldi, toplandı mı" ayırt edilemezdi.
//
// NEGATİF SONDA (boz-ölç-geri yükle; yeni/izlenmeyen dosyada `git checkout`
// çalışmaz → `cp` yedeği + `shasum` ile geri yüklendi. ÖLÇÜLEN sonuçlar):
//   • `fxTone` sıfırı "gain" saydı (`n > 0` → `n >= 0`) → 1 kırmızı (§3b).
//   • Toplam satırının `amount` hücresi istemcide toplandı → 1 kırmızı (§5b).
//   • `diffTry` `Math.abs` ile mutlaklaştırıldı → 2 kırmızı (§4b, §4c).
//   • Spec'ten "Kaynak Kuru" kolonu düşürüldü → 2 kırmızı (§2b, §4e).
//
// ⚠️ SON SONDANIN ÖĞRETTİĞİ: §1 bu durumda YEŞİL kaldı ve bu DOĞRU — §1 iki
// ÇIKTININ birbirinden ayrışmasını ölçer, kolon spec'ten düşünce ikisi birden
// düşer ve eşitlik korunur. Ekranla dosyanın ayrışmasını ölçen tek kontrol
// §2b'dir; onu silmek "dosyada eksik kolon" sınıfını bekçisiz bırakır.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "../_components/reportExport";
import { buildFxDiffExport } from "./fxDiffExport";
import { FX_TONE_CLASS, FX_TONE_METRIC, fxTone, type FxDiffReport } from "./fxDiffService";

/** Ekrandaki satır tablosunun başlıkları — KAYNAKTAN okunur. */
function screenHeaders(relPath: string): string[] {
  const src = readFileSync(resolve(__dirname, relPath), "utf8");
  const thead = /<thead[\s\S]*?<\/thead>/.exec(src)?.[0] ?? "";
  return [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
}

const SCREEN_HEADERS = screenHeaders("./FxDiffPage.tsx");

/**
 * Fixture — üç kapama, üç yön:
 *  • USD satış faturası, kaynak kuru YÜKSEK → LEHTE (+2.500,00)
 *  • EUR alış faturası, kaynak kuru yüksek → ALEYHTE (−500,00)
 *  • USD satış, kurlar EŞİT → fark 0 (satır yine listelenir)
 *
 * ⚠️ `netTry` bilerek 2.000,00 (= 2.500 − 500) ama satır toplamıyla aynı olmayan
 * bir yol izlemesi için §5c'de ayrıca "backend'den geldiği" ölçülür.
 */
const BASE: FxDiffReport = {
  rows: [
    {
      allocationId: "a1",
      allocatedAt: "2026-08-10T09:30:00.000Z",
      cari: { id: "c1", name: "ACME Tekstil A.Ş." },
      invoice: { docNo: "SF2026000012", type: "SALES", currency: "USD", exchangeRate: "32.0000" },
      source: { kind: "PAYMENT", docNo: "TH2026000045", label: "Tahsilat", exchangeRate: "34.5000" },
      amount: "1000.00",
      signedDiffTry: "2500.00",
    },
    {
      allocationId: "a2",
      allocatedAt: "2026-08-09T14:00:00.000Z",
      cari: { id: "c2", name: "Beta Boya Ltd." },
      invoice: { docNo: "AF2026000007", type: "PURCHASE", currency: "EUR", exchangeRate: "38.0000" },
      source: { kind: "CHEQUE", docNo: "CK2026000003", label: "Verdiğimiz çek/senet", exchangeRate: "39.0000" },
      amount: "500.00",
      signedDiffTry: "-500.00",
    },
    {
      allocationId: "a3",
      allocatedAt: "2026-08-08T08:00:00.000Z",
      cari: { id: "c1", name: "ACME Tekstil A.Ş." },
      invoice: { docNo: "SF2026000013", type: "SALES", currency: "USD", exchangeRate: "33.0000" },
      source: { kind: "PAYMENT", docNo: "TH2026000046", label: "Tahsilat", exchangeRate: "33.0000" },
      amount: "200.00",
      signedDiffTry: "0.00",
    },
  ],
  summary: {
    count: 3,
    gainTry: "2500.00",
    lossTry: "500.00",
    netTry: "2000.00",
    byCurrency: [
      { currency: "USD", count: 2, gainTry: "2500.00", lossTry: "0.00", netTry: "2500.00" },
      { currency: "EUR", count: 1, gainTry: "0.00", lossTry: "500.00", netTry: "-500.00" },
    ],
  },
};

const build = (r: FxDiffReport = BASE) =>
  buildFxDiffExport({ report: r, periodLabel: "01.08.2026 – 14.08.2026" });

describe("kur farkı — işaret ve dışa aktarım", () => {
  // ---------------------------------------------------------------------------
  it("§1 Excel kolonları ile PDF başlıkları BİREBİR aynı (iki tablonun her biri)", () => {
    const spec = build();
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);

    expect(sheets).toHaveLength(2);
    spec.tables.forEach((t, i) => {
      expect(sheets[i]!.columns.map((c) => c.header)).toEqual(t.columns.map((c) => c.header));
      for (const c of t.columns) expect(html).toContain(`>${c.header}</th>`);
    });
  });

  it("§1b PDF YATAY basılır (11 kolonun dördü sayı taşıyor; dikeyde sarıyordu)", () => {
    expect(build().orientation).toBe("landscape");
  });

  it("§1c kapsam ve okuma notları dosyanın İÇİNDE — filtreli dosya filtresiz okunmasın", () => {
    const spec = buildFxDiffExport({
      report: BASE,
      periodLabel: "01.08.2026 – 14.08.2026",
      scopeLines: ["Cari süzgeci: ACME Tekstil A.Ş.", "Para birimi süzgeci: USD"],
    });
    expect(spec.meta).toContain("Cari süzgeci: ACME Tekstil A.Ş.");
    expect(spec.meta).toContain("Para birimi süzgeci: USD");
    expect((spec.meta ?? []).join(" ")).toContain("türetilir");
    // Notlar Excel sayfasına da düşer (PDF'teki gibi başlığın altında) — sayfa tek başına paylaşılabiliyor.
    expect((toSheets(spec)[0]!.preamble ?? []).map((r) => String(r[0]))).toEqual(
      expect.arrayContaining(["Cari süzgeci: ACME Tekstil A.Ş."]),
    );
  });

  // ---------------------------------------------------------------------------
  it("§2a ekranın başlıkları gerçekten okundu (körlük zemini)", () => {
    expect(SCREEN_HEADERS.length).toBeGreaterThanOrEqual(10);
    expect(SCREEN_HEADERS).toContain("Kur Farkı (TL)");
    expect(SCREEN_HEADERS).toContain("Fatura Kuru");
  });

  it("§2b EKRANDA görünen her kolon DOSYADA da var", () => {
    const specHeaders = build().tables[0]!.columns.map((c) => c.header);
    for (const h of SCREEN_HEADERS) {
      expect(specHeaders.includes(h), `ekranda "${h}" var, dışa aktarımda yok`).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  it("§3a ⭐ İŞARET → TON: + lehte, − aleyhte", () => {
    expect(fxTone("2500.00")).toBe("gain");
    expect(fxTone("-500.00")).toBe("loss");
    expect(fxTone(12.5)).toBe("gain");
    expect(fxTone(-0.01)).toBe("loss");
  });

  it("§3b ⭐ SIFIR nötrdür — '-0.00' da (metne bakıp '−' arayan kontrol aleyhte derdi)", () => {
    expect(fxTone("0.00")).toBe("flat");
    expect(fxTone("-0.00")).toBe("flat");
    expect(fxTone(0)).toBe("flat");
  });

  it("§3c ⭐ OKUNAMAYAN değer nötr — yeşile boyamak 'kambiyo kârı' iddiasıdır", () => {
    expect(fxTone("")).toBe("flat");
    expect(fxTone(null)).toBe("flat");
    expect(fxTone(undefined)).toBe("flat");
    expect(fxTone("abc")).toBe("flat");
    expect(fxTone(Number.NaN)).toBe("flat");
  });

  it("§3d üç ton üç AYRI görünüm üretir (renk ve kart tonu çakışmaz)", () => {
    const classes = [FX_TONE_CLASS.gain, FX_TONE_CLASS.loss, FX_TONE_CLASS.flat];
    expect(new Set(classes).size).toBe(3);
    expect(FX_TONE_METRIC.gain).toBe("ok");
    expect(FX_TONE_METRIC.loss).toBe("bad");
    expect(FX_TONE_METRIC.flat).toBe("neutral");
  });

  // ---------------------------------------------------------------------------
  it("§4a tutar/kur hücreleri SAYI (string girerse numFmt uygulanmaz, toplanamaz)", () => {
    const row = build().tables[0]!.rows[0]!;
    for (const cell of ["invoiceRate", "sourceRate", "amount", "diffTry"]) {
      expect(typeof row[cell], `${cell} sayı olmalı`).toBe("number");
    }
    expect(row.invoiceRate).toBe(32);
    expect(row.sourceRate).toBe(34.5);
  });

  it("§4b ⭐ İŞARET KORUNUR: aleyhte satır dosyada da NEGATİF", () => {
    const rows = build().tables[0]!.rows;
    expect(rows[0]!.diffTry).toBe(2500);
    expect(rows[1]!.diffTry).toBe(-500);
  });

  it("§4c mutlaklaştırma yok — negatif satır pozitife dönmez", () => {
    const negatives = build()
      .tables[0]!.rows.map((r) => r.diffTry as number)
      .filter((n) => n < 0);
    expect(negatives).toEqual([-500]);
  });

  it("§4d FARKI SIFIR olan kapama dosyada DURUR (gizlemek 'kapama olmadı' derdi)", () => {
    const rows = build().tables[0]!.rows;
    expect(rows).toHaveLength(BASE.rows.length);
    expect(rows.some((r) => r.diffTry === 0 && r.docNo === "SF2026000013")).toBe(true);
  });

  it("§4e PDF hücresi tr-TR biçimli: kur 4 hane, tutar 2 hane", () => {
    const html = buildReportHtml(build());
    expect(html).toContain(">34,5000<"); // kaynak kuru — 2 haneye yuvarlanmadı
    expect(html).toContain(">2.500,00<"); // TL fark
    expect(html).toContain(">-500,00<");
  });

  // ---------------------------------------------------------------------------
  it("§5a satır YOKKEN toplam yazılmaz ('TOPLAM 0' veri yokluğunu sıfır diye okutur)", () => {
    const emptyReport: FxDiffReport = {
      rows: [],
      summary: { count: 0, gainTry: "0.00", lossTry: "0.00", netTry: "0.00", byCurrency: [] },
    };
    const spec = build(emptyReport);
    expect(spec.tables[0]!.totalRow).toBeUndefined();
    expect(spec.tables[1]!.totalRow).toBeUndefined();
  });

  it("§5b ⭐ FX 'Tutar' TOPLAM hücresi BOŞ — USD+EUR toplamı anlamsız, istemci de toplamaz", () => {
    const total = build().tables[0]!.totalRow!;
    expect(total.amount).toBe("");
    // Negatif sonda buraya bakar: 1000+500+200 = 1700 sızarsa kırmızı.
    expect(total.amount).not.toBe(1700);
  });

  it("§5c ⭐ TL toplamı BACKEND'DEN (`summary.netTry`) — istemcide toplanmaz", () => {
    // netTry bilerek satır toplamından AYRI bir değere kurulur: eşit olsaydı
    // "okundu mu, toplandı mı" ayırt edilemezdi (körlük zemini).
    const drifted: FxDiffReport = {
      ...BASE,
      summary: { ...BASE.summary, netTry: "1234.56" },
    };
    expect(build(drifted).tables[0]!.totalRow!.diffTry).toBe(1234.56);
  });

  // ---------------------------------------------------------------------------
  it("§6 para birimi kırılımı ve toplamı BACKEND rakamlarından", () => {
    const t = build().tables[1]!;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toMatchObject({ currency: "USD", count: 2, gain: 2500, loss: 0, net: 2500 });
    expect(t.rows[1]).toMatchObject({ currency: "EUR", count: 1, gain: 0, loss: 500, net: -500 });
    expect(t.totalRow).toMatchObject({ currency: "TOPLAM", count: 3, gain: 2500, loss: 500, net: 2000 });
  });
});
