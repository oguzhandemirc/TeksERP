import { describe, expect, it } from "vitest";
import { buildReportHtml, reportRowCount, slugifyFileName, toSheets, type ReportExportSpec } from "./reportExport";

const SPEC: ReportExportSpec = {
  title: "Kalite Karnesi",
  subtitle: "01.07.2026 – 31.07.2026",
  meta: ["Oranlar METRAJ ağırlıklıdır.", "Karşılaştırma dönemi: Haziran"],
  tables: [
    {
      name: "Kumaş Bazında",
      columns: [
        { header: "Kumaş", key: "label" },
        { header: "Toplam (m)", key: "totalQty", numFmt: "#,##0.0", align: "right" },
        { header: "1. Kalite %", key: "pct", numFmt: "0.0", align: "right" },
      ],
      rows: [
        { label: "POPERMAN & SİMLİ <özel>", totalQty: 654, pct: 92 },
        { label: "PANOS", totalQty: 222, pct: 9.9 },
      ],
      totalRow: { label: "TOPLAM", totalQty: 876, pct: 71.1 },
      notes: ["Fire dahildir."],
    },
  ],
};

describe("rapor dışa aktarım — tek spec, iki çıktı", () => {
  // ASIL GARANTİ: Excel ile PDF aynı spec'ten türer, yani kolon kümesi
  // ayrışamaz. Bu test o eşitliği MEKANİK doğrular — biri elle güncellenip
  // diğeri unutulursa (bu projede bir kez yaşanan "aynı belge üç ekranda üç
  // rakam" sınıfı) burada kırmızı verir.
  it("Excel kolonları ile PDF başlıkları BİREBİR aynı", () => {
    const sheets = toSheets(SPEC);
    const html = buildReportHtml(SPEC);
    const table = SPEC.tables[0]!;

    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.columns.map((c) => c.header)).toEqual(table.columns.map((c) => c.header));
    for (const c of table.columns) {
      expect(html).toContain(`>${c.header}</th>`);
    }
  });

  it("her satır değeri iki çıktıda da var — PDF hücresi tr-TR biçimli (2026-08-14)", () => {
    const sheets = toSheets(SPEC);
    const html = buildReportHtml(SPEC);
    // Excel HAM SAYI taşır (numFmt hücre biçimidir, değer değil):
    expect(sheets[0]!.rows).toEqual(SPEC.tables[0]!.rows);
    // PDF/Yazdır ise numFmt'li kolonu tr-TR basar — eskiden "12500.5" gibi
    // çıplak basılıyordu; ondalık hane sayısı numFmt'ten okunur.
    expect(html).toContain("654,0");
    expect(html).toContain("222,0");
    expect(html).toContain("9,9");
  });

  it("numFmt'siz kolon ve sayı olmayan değer AYNEN basılır (sayıya zorlanmaz)", () => {
    const spec: ReportExportSpec = {
      title: "T",
      tables: [{
        name: "T",
        columns: [
          { header: "Ad", key: "a" },
          { header: "Tutar", key: "b", numFmt: "#,##0.00", align: "right" },
        ],
        rows: [
          { a: "12500.5", b: 12500.5 },
          { a: "x", b: "—" },
        ],
      }],
    };
    const html = buildReportHtml(spec);
    // numFmt'siz kolondaki sayı GÖRÜNÜMLÜ metin dokunulmadan geçer:
    expect(html).toContain(">12500.5<");
    // numFmt'li kolonda gerçek sayı biçimlenir (binlik + 2 hane):
    expect(html).toContain(">12.500,50<");
    // sayı olmayan değer ("—") biçimlendirilmeye ÇALIŞILMAZ:
    expect(html).toContain(">—<");
  });

  it("TOPLAM satırı iki çıktıda da var", () => {
    expect(toSheets(SPEC)[0]!.totalRow).toEqual(SPEC.tables[0]!.totalRow);
    expect(buildReportHtml(SPEC)).toContain('class="tot"');
    expect(buildReportHtml(SPEC)).toContain("TOPLAM");
  });

  it("başlık notları HER Excel sayfasının ÜSTÜNE düşer (PDF'teki gibi; sayfa tek başına paylaşılabiliyor)", () => {
    const sheets = toSheets(SPEC);
    for (const s of sheets) {
      const ust = (s.preamble ?? []).map((r) => String(r[0]));
      expect(ust).toContain("Oranlar METRAJ ağırlıklıdır.");
      expect(ust).toContain("Karşılaştırma dönemi: Haziran");
    }
    expect(sheets[0]!.notes ?? []).toContain("Fire dahildir."); // tablonun kendi notu altta korunur
  });

  it("HTML kaçırma: serbest metin kumaş adı belgeyi bozmaz", () => {
    const html = buildReportHtml(SPEC);
    // Fabrika kumaş adına & ve < yazabiliyor; kaçırılmazsa belge bozulur.
    expect(html).toContain("POPERMAN &amp; SİMLİ &lt;özel&gt;");
    expect(html).not.toContain("SİMLİ <özel>");
  });

  it("çok sayfalı tabloda kolon başlıkları tekrar eder (thead grubu)", () => {
    const html = buildReportHtml(SPEC);
    expect(html).toContain("<thead>");
    // Bu kural olmadan ikinci sayfa kolon adı olmayan çıplak sayı bloğu basar.
    expect(html).toContain("display: table-header-group");
  });

  it("sayısal kolonlar sağa yaslanır (hem başlık hem hücre)", () => {
    const html = buildReportHtml(SPEC);
    expect(html).toContain('<th style="text-align:right">Toplam (m)</th>');
    expect(html).toContain('<td style="text-align:right">654,0</td>');
    expect(html).toContain('<th style="text-align:left">Kumaş</th>');
  });

  it("A4 sayfa yönü: verilmezse DİKEY (mevcut çıktı korunur), landscape istenince YATAY", () => {
    expect(buildReportHtml(SPEC)).toContain("@page { size: A4 portrait");
    expect(buildReportHtml({ ...SPEC, orientation: "landscape" })).toContain("@page { size: A4 landscape");
  });

  it("dosya adı Türkçe karakterleri düzleştirir", () => {
    expect(slugifyFileName("Kalite Karnesi 01.07.2026 – 31.07.2026")).toBe(
      "kalite-karnesi-01-07-2026-31-07-2026",
    );
    expect(slugifyFileName("Fason Çıkış Şubat")).toBe("fason-cikis-subat");
  });
});

// ---------- Rapor v2 blokları (R0-GRAFIK) ------------------------------------
// Grafik PDF'e SVG (vektör), Excel'e VERİ TABLOSU olarak geçer; ana sayı, anlatı ve
// tanımlar Excel'de "Özet" sayfasında PDF'teki AYNI metinle durur.
// Negatif sonda (2026-10-24): `blockHtml` grafik dalında SVG atlandı (tabloya düştü) → 2 ❌.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 300"><text>çizim</text></svg>';
const veri = {
  name: "Günlük sevk",
  columns: [
    { header: "Gün", key: "k" },
    { header: "Bu dönem (m)", key: "s0", numFmt: "#,##0.0", align: "right" as const },
  ],
  rows: [
    { k: "01.10.2026", s0: 12500.5 },
    { k: "02.10.2026", s0: 9800 },
  ],
};
const V2: ReportExportSpec = {
  ...SPEC,
  soru: "Siparişler terminde gitti mi?",
  kiyasDonemi: "Eylül 2026",
  parametreCumlesi: "Müşteri: Kaya Tekstil · Renk: tümü",
  kullanici: "Ayşe",
  basimAni: "2026-10-24T11:02:00Z",
  uyarilar: ["Termini olmayan 12 sipariş orana katılmadı."],
  bloklar: [
    { tur: "anaSayi", kartlar: [{ ad: "Zamanında teslim", deger: "%78", kiyas: "▼ 6 puan (eylül %84)", ana: true }, { ad: "Geciken", deger: "23 sipariş" }] },
    { tur: "anlati", cumleler: ["Siparişlerin %78'i terminde gitti; eylüle göre 6 puan düşük."] },
    { tur: "grafik", baslik: "Günlük sevk", svg: SVG, veri },
    { tur: "tanimlar", satirlar: [{ ad: "Zamanında teslim", aciklama: "Termin gününe kadar sevk edilen siparişlerin payı." }] },
  ],
};

describe("rapor v2 blokları — grafik PDF'te SVG, Excel'de veri sayfası", () => {
  it("⭐ grafik bloğu PDF HTML'inde gömülü SVG + başlık (dış kaynak yok)", () => {
    const html = buildReportHtml(V2);
    expect(html).toContain('<section class="grafik"><h2>Günlük sevk</h2><div class="svg"><svg');
    expect(html).not.toMatch(/<img|<link|src="http/);
  });

  it("⭐ Excel: Özet + grafik veri sayfası + tablolar; veri sayfası grafiğin tablosu", () => {
    const sheets = toSheets(V2);
    expect(sheets.map((s) => s.name)).toEqual(["Özet", "Günlük sevk", "Kumaş Bazında"]);
    expect(sheets[1]!.rows).toEqual(veri.rows);
    expect(sheets[1]!.columns[1]!.numFmt).toBe("#,##0.0");
  });

  it("⭐ görünen metin eşitliği: kart, anlatı, tanım, uyarı ve üst blok iki çıktıda aynı", () => {
    const html = buildReportHtml(V2);
    const sheets = toSheets(V2);
    const ozet = sheets[0]!.rows.flatMap((r) => Object.values(r).map(String));
    const ust = (sheets[0]!.preamble ?? []).map((r) => String(r[0]));
    for (const metin of ["%78", "▼ 6 puan (eylül %84)", "23 sipariş", "Siparişlerin %78'i terminde gitti; eylüle göre 6 puan düşük.", "Termin gününe kadar sevk edilen siparişlerin payı.", "Termini olmayan 12 sipariş orana katılmadı."]) {
      expect(ozet, metin).toContain(metin);
      expect(html, metin).toContain(metin);
    }
    for (const satir of ["Siparişler terminde gitti mi?", "Dönem: 01.07.2026 – 31.07.2026", "Kıyas: Eylül 2026", "Müşteri: Kaya Tekstil · Renk: tümü", "Basım: 24.10.2026 14:02 · Ayşe"]) {
      expect(ust, satir).toContain(satir);
      expect(html, satir).toContain(satir);
    }
  });

  it("blok sırası: ana sayı → anlatı → grafik → tablolar → tanımlar → uyarılar", () => {
    const html = buildReportHtml(V2);
    const sira = ['class="kartlar"', 'class="anlati"', 'class="grafik"', 'class="tbl-wrap"', 'class="tanimlar"', 'class="uyari"'].map((k) => html.indexOf(k));
    expect(sira.every((v) => v > 0)).toBe(true);
    expect([...sira].sort((a, b) => a - b)).toEqual(sira);
  });

  it("baskı CSS'i: A4 14/12/16 mm, grafik bölünmez, renk korunur, thead tekrar", () => {
    const html = buildReportHtml(V2);
    expect(html).toContain("@page { size: A4 portrait; margin: 14mm 12mm 16mm; }");
    expect(html).toContain(".grafik { break-inside: avoid; }");
    expect(html).toContain("print-color-adjust: exact");
    expect(html).toContain("thead { display: table-header-group; }");
  });

  it("SVG'siz grafik: PDF grafiğin veri tablosunu basar (kâğıda hiçbir şey düşmez değil)", () => {
    const spec: ReportExportSpec = { ...V2, bloklar: [{ tur: "grafik", baslik: "Günlük sevk", veri }] };
    const html = buildReportHtml(spec);
    expect(html).not.toContain("<svg");
    expect(html).toContain("<h2>Günlük sevk</h2>");
    expect(html).toContain('<td style="text-align:right">12.500,5</td>');
  });

  it("PDF satır kapısı grafik veri satırlarını da sayar", () => {
    expect(reportRowCount(V2)).toBe(3 + 2);
    expect(reportRowCount(SPEC)).toBe(3);
  });

  it("serbest metin v2 bloklarında da kaçırılır", () => {
    const html = buildReportHtml({ ...V2, bloklar: [{ tur: "anlati", cumleler: ["A & <b>B</b>"] }] });
    expect(html).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;");
  });
});
