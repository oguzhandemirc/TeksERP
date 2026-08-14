import { describe, expect, it } from "vitest";
import { buildReportHtml, slugifyFileName, toSheets, type ReportExportSpec } from "./reportExport";

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

  it("başlık notları HER Excel sayfasına düşer (sayfa tek başına paylaşılabiliyor)", () => {
    const notes = toSheets(SPEC)[0]!.notes ?? [];
    expect(notes).toContain("Oranlar METRAJ ağırlıklıdır.");
    expect(notes).toContain("Karşılaştırma dönemi: Haziran");
    expect(notes).toContain("Fire dahildir."); // tablonun kendi notu da korunur
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
