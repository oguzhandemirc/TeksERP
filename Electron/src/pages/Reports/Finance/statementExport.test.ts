// =============================================================================
// CARİ EKSTRE DIŞA AKTARIM BEKÇİSİ
// =============================================================================
// Ölçtüğü üç şey:
//  §1 Excel ↔ PDF kolon eşitliği (tek spec sözleşmesi, `reportExport.test` emsali).
//  §2 EKRAN ↔ SPEC kolon eşitliği — iki ekstre yüzeyinin `<thead>`'i KAYNAKTAN
//     okunur. Bu, "ekrana kolon eklendi, dosyaya eklenmedi" (ve tersi) sınıfını
//     yakalayan tek mekanik kontroldür; ikisi ayrışırsa aynı ekranın dosyası
//     eksik bilgi taşır ve bunu kimse fark etmez.
//  §3-§8 İçerik sözleşmesi: devir satırı, boş dönem, sıfır hücre, sayı tipi,
//     tarih biçimi, cari kodu.
//
// ⚠️ §1 TEK BAŞINA YETMEZ ve bu ÖLÇÜLDÜ: kolon spec'ten düşünce Excel ile PDF
// onu BİRLİKTE kaybeder (tek spec sözleşmesinin doğal sonucu) ve §1 yeşil kalır.
// "Dosya ekranla aynı şeyi söylüyor mu" sorusunun tek bekçisi §2'dir.
//
// NEGATİF SONDA (boz-ölç-geri yükle, TEK zincir; yeni dosyada `git checkout`
// ÇALIŞMAZ → `cp` yedeği + shasum ile geri yükleme doğrulandı) — ÖLÇÜLEN sonuçlar:
//   • `COLUMNS`ten "Kaynak" satırı SİLİNDİ → 2 kırmızı (§2a, §2b); §1 yeşil kaldı.
//   • Devir satırı `rows` başından çıkarıldı → 5 kırmızı (§3, §4, §5, §6, §7b —
//     satır kayması sonraki kontrolleri de düşürür).
//   • `sideCell` sıfırı boşa çevirmeyi bıraktı → 1 kırmızı (§5).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "../_components/reportExport";
import { buildStatementExport, type StatementExportInput } from "./statementExport";

/**
 * Ekrandaki tablonun kolon başlıkları — KAYNAKTAN okunur.
 * Kendi kendini kapatan `<th … />` (çek tablosundaki aksiyon sütunu gibi)
 * eşleşmez: `([^<]+)` en az bir metin karakteri ister.
 */
function tableHeaders(relPath: string): string[] {
  const src = readFileSync(resolve(__dirname, relPath), "utf8");
  const thead = /<thead[\s\S]*?<\/thead>/.exec(src)?.[0] ?? "";
  return [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
}

const REPORT_HEADERS = tableHeaders("./CariStatementDialog.tsx");
const FINANCE_HEADERS = tableHeaders("../../Finance/StatementDialog.tsx");

const INPUT = (over: Partial<StatementExportInput> = {}): StatementExportInput => ({
  cariName: "PATOS TEKSTİL & TİC. <A.Ş.>",
  currency: "TRY",
  fromYmd: "2026-07-01",
  toYmd: "2026-07-31",
  opening: "1250.5",
  closing: "3400.75",
  totalDebit: "5000",
  totalCredit: "2850.25",
  rows: [
    {
      txnDate: "2026-07-05T09:00:00.000Z",
      docNo: "SF0507260001",
      sourceType: "INVOICE",
      description: "Temmuz satış",
      debit: "5000",
      credit: "0",
      running: "6250.5",
    },
    {
      txnDate: "2026-07-20T09:00:00.000Z",
      docNo: "TH2007260001",
      sourceType: "PAYMENT",
      description: null,
      debit: "0",
      credit: "2850.25",
      running: "3400.25",
    },
    // Etiketi olmayan kaynak — ham enum basılır (sözlük eksiği görünür olsun).
    {
      txnDate: "2026-07-25T09:00:00.000Z",
      docNo: null,
      sourceType: "YENI_KAYNAK",
      description: "bilinmeyen",
      debit: "0.5",
      credit: "0",
      running: "3400.75",
    },
  ],
  ...over,
});

const table = (input = INPUT()) => buildStatementExport(input).tables[0]!;
const headers = (input = INPUT()) => table(input).columns.map((c) => c.header);

describe("cari ekstre dışa aktarımı", () => {
  // ---------------------------------------------------------------------------
  it("§1 Excel kolonları ile PDF başlıkları BİREBİR aynı", () => {
    const spec = buildStatementExport(INPUT());
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.columns.map((c) => c.header)).toEqual(headers());
    for (const h of headers()) expect(html).toContain(`>${h}</th>`);
  });

  it("§1b notlar HER iki çıktıda da taşınır (bağlam rakamla aynı dosyada durur)", () => {
    const spec = buildStatementExport(INPUT());
    const sheetNotes = toSheets(spec)[0]!.notes ?? [];
    // Başlık meta'sı + tablo notları Excel sayfasına birlikte düşer.
    expect(sheetNotes.some((n) => n.includes("Para birimi: TRY"))).toBe(true);
    expect(sheetNotes.some((n) => n.includes("Dönem devri"))).toBe(true);
    expect(buildReportHtml(spec)).toContain("Dönem devri");
  });

  // ---------------------------------------------------------------------------
  // §2 — EKRAN ↔ SPEC. Körlük zemini: regex boşa düşerse "ihlal yok" ile
  // "hiçbir şeye bakılmadı" aynı yeşile çıkar.
  it("§2 iki ekstre ekranının başlıkları gerçekten okundu (körlük zemini)", () => {
    expect(REPORT_HEADERS.length).toBeGreaterThanOrEqual(6);
    expect(FINANCE_HEADERS.length).toBeGreaterThanOrEqual(6);
    expect(REPORT_HEADERS).toContain("Bakiye");
    expect(FINANCE_HEADERS).toContain("Bakiye");
  });

  it("§2a rapor yüzeyindeki tablo ile spec kolonları BİREBİR aynı", () => {
    expect(headers()).toEqual(REPORT_HEADERS);
  });

  it("§2b ön muhasebe yüzeyiyle TEK fark 'Kaynak' — ve o kolon bilinçli olarak dosyada VAR", () => {
    // Ekranda çizilmiyor ama veri iki uçta da dönüyor. Aynı başlıklı iki dosyanın
    // farklı içerik taşımaması için dosya tarafında birleştirildi.
    const missing = headers().filter((h) => !FINANCE_HEADERS.includes(h));
    expect(missing).toEqual(["Kaynak"]);
    // Ters yön: ekranda olup dosyada olmayan kolon KALMAMALI.
    expect(FINANCE_HEADERS.filter((h) => !headers().includes(h))).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  it("§3 DEVİR satırı ilk satırdır; bakiyesi `opening`, borç/alacak hücresi boş", () => {
    const t = table();
    const first = t.rows[0]!;
    expect(String(first.description)).toContain("Dönem devri");
    expect(String(first.description)).toContain("01.07.2026");
    expect(first.running).toBe(1250.5);
    expect(first.debit).toBe("");
    expect(first.credit).toBe("");
    // Hareketler devirden SONRA gelir (yürüyen bakiye ancak böyle doğrulanır).
    expect(t.rows).toHaveLength(4);
    expect(t.rows[1]!.docNo).toBe("SF0507260001");
  });

  it("§3b devir MÜHÜRLÜ kapanıştan geliyorsa kaynağı yazılır, gelmiyorsa düz toplam denir", () => {
    const sealed = table(INPUT({ carriedFrom: { periodEnd: "2026-06-30T00:00:00.000Z", closingBalance: "1250.5" } }));
    expect(sealed.notes?.[0]).toContain("30.06.2026 kapanışının MÜHÜRLÜ bakiyesinden");

    expect(table().notes?.[0]).toContain("dönem başından ÖNCEKİ tüm hareketlerin toplamıdır");
  });

  // ---------------------------------------------------------------------------
  it("§4 hareketsiz dönem: devir + TOPLAM yine basılır, sebep NOT olarak yazılır", () => {
    const t = table(INPUT({ rows: [], totalDebit: "0", totalCredit: "0", closing: "1250.5" }));
    expect(t.rows).toHaveLength(1); // yalnız devir
    expect(String(t.rows[0]!.description)).toContain("Dönem devri");
    expect(t.totalRow?.running).toBe(1250.5);
    expect(t.notes?.some((n) => n.includes("Bu dönemde hareket yok"))).toBe(true);
    // Boş tablo da basılabilir olmalı (çıktı yolu düşmez).
    expect(buildReportHtml(buildStatementExport(INPUT({ rows: [] })))).toContain("DÖNEM TOPLAMI");
  });

  // ---------------------------------------------------------------------------
  it("§5 sıfır borç/alacak hücresi BOŞ, ama TOPLAM satırında 0 BASILIR", () => {
    const t = table();
    expect(t.rows[1]!.credit).toBe(""); // fatura satırı: alacak yok
    expect(t.rows[2]!.debit).toBe(""); // tahsilat satırı: borç yok
    const zero = table(INPUT({ totalDebit: "0", totalCredit: "0" }));
    expect(zero.totalRow?.debit).toBe(0);
    expect(zero.totalRow?.credit).toBe(0);
  });

  it("§6 tutarlar Excel'e SAYI gider (string'e numFmt uygulanmaz)", () => {
    const t = table();
    expect(typeof t.rows[1]!.debit).toBe("number");
    expect(t.rows[1]!.debit).toBe(5000);
    expect(typeof t.rows[3]!.running).toBe("number");
    for (const key of ["debit", "credit", "running"]) {
      expect(t.columns.find((c) => c.key === key)?.numFmt).toBe("#,##0.00");
      expect(t.columns.find((c) => c.key === key)?.align).toBe("right");
    }
  });

  it("§7 dönem/tarih biçimi tr-TR; dönem ve para birimi başlıkta", () => {
    const spec = buildStatementExport(INPUT());
    expect(spec.subtitle).toBe("01.07.2026 – 31.07.2026 · TRY");
    // Gün, saat diliminden BAĞIMSIZ üretilir (parçalardan) — `new Date("…")`
    // negatif UTC farkında günü bir geri kaydırırdı.
    expect(spec.subtitle).not.toContain("30.06.2026");
    expect(String(table().rows[1]!.date)).toMatch(/^\d{2}\.\d{2}\.2026$/);
  });

  it("§7b kaynak etiketi sözlükten gelir; etiketsiz değer HAM basılır (sessizce boş kalmaz)", () => {
    const t = table();
    expect(t.rows[1]!.source).toBe("Fatura");
    expect(t.rows[3]!.source).toBe("YENI_KAYNAK");
  });

  it("§8 cari kodu verilmezse parantez BASILMAZ (uydurulmaz), verilirse basılır", () => {
    const meta = (over?: Partial<StatementExportInput>) =>
      (buildStatementExport(INPUT(over)).meta ?? []).find((m) => m.startsWith("Cari:")) ?? "";
    expect(meta()).toBe("Cari: PATOS TEKSTİL & TİC. <A.Ş.>");
    expect(meta({ cariCode: "CR-0007" })).toContain("(CR-0007)");
  });

  it("§8b serbest metin cari adı PDF'i bozmaz (kaçırma)", () => {
    const html = buildReportHtml(buildStatementExport(INPUT()));
    expect(html).toContain("PATOS TEKSTİL &amp; TİC. &lt;A.Ş.&gt;");
    expect(html).not.toContain("TİC. <A.Ş.>");
  });
});
