// =============================================================================
// ÇEK VADE TAKVİMİ — DIŞA AKTARIM + KATLAMA BEKÇİSİ
// =============================================================================
// Ölçtüğü altı şey:
//  §1 Excel ↔ PDF kolon eşitliği (tek spec sözleşmesi; `statementExport.test`
//     emsali).
//  §2 EKRAN ⊆ SPEC — `ChequeDuePage.tsx`'in `<thead>`'i KAYNAKTAN okunur.
//     Yön TEK TARAFLIDIR ve bilinçli: dosyanın ekrandan FAZLA kolon taşıması
//     meşrudur (ilk/son gün bağlamı kâğıtta durmalı), ama ekranda görünüp
//     dosyada olmayan bir kolon "aynı rapor, eksik dosya" demektir.
//  §3 `foldCalendar` — para birimleri TOPLANMAZ, net YALNIZ aynı birimde.
//  §4 TOPLAM satırı yalnız TEK para biriminde ve yalnız satır varken.
//  §5 Kova tablosu portföyün TAMAMINI taşır (pencere DIŞINDAKİ `LATER` kovası
//     dosyada DURUR) — raporun temel iddiası budur.
//  §6 Tutarlar hücreye SAYI olarak girer (string girerse Excel'de sağa
//     hizalanmaz, `numFmt` uygulanmaz ve toplanamaz).
//
// ⚠️ KÖRLÜK ZEMİNİ: §2'nin regex'i boşa düşerse "ihlal yok" ile "hiçbir şeye
// bakılmadı" AYNI yeşile çıkar — bu yüzden başlık sayısı ve bilinen bir başlık
// ayrıca doğrulanır.
//
// NEGATİF SONDA (boz-ölç-geri yükle, TEK zincir; yeni/izlenmeyen dosyada
// `git checkout` çalışmaz → `cp` yedeği + `shasum`) — ÖLÇÜLEN sonuçlar
// `chequeDueExport.ts` üzerinde:
//   • `totalRow` koşulundan `single &&` düştü (karışık birimde de toplasın) →
//     1 kırmızı (§4b).
//   • `foldCalendar` anahtarından para birimi düştü (birimler tek satıra
//     katlandı) → 4 kırmızı (§3a, §3b, §3c ve ayrıca §4b: karışık birim tek
//     satıra katlanınca "tek para birimi" sanılıp TOPLAM satırı doğdu — hatanın
//     dışa aktarıma kadar taşındığını gösteren zincir).
//   • Kova tablosu `data.buckets` yerine pencereye kısıldı → 1 kırmızı (§5).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "../_components/reportExport";
import { buildChequeDueExport } from "./chequeDueExport";
import { DUE_BUCKET_LABEL, foldCalendar, type ChequeDueSummary } from "./chequeDueService";

/** Ekrandaki takvim tablosunun başlıkları — KAYNAKTAN okunur. */
function screenHeaders(relPath: string): string[] {
  const src = readFileSync(resolve(__dirname, relPath), "utf8");
  const thead = /<thead[\s\S]*?<\/thead>/.exec(src)?.[0] ?? "";
  return [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
}

const SCREEN_HEADERS = screenHeaders("./ChequeDuePage.tsx");

/**
 * Ekranın "Dönem" kolonu spec'te dönem BİRİMİYLE adlandırılır (Hafta / Ay) —
 * aynı veri, daha açık başlık. Eşleme burada YAZILI: sessiz bir istisna
 * listesi, gerçek bir kolon kaybını da yutardı.
 */
const HEADER_ALIAS: Record<string, string[]> = { Dönem: ["Hafta", "Ay"] };

const BASE: ChequeDueSummary = {
  today: "2026-08-14",
  soonDays: 7,
  window: { from: "2026-08-14", to: "2026-09-13" },
  buckets: [
    { bucket: "OVERDUE", kind: "RECEIVED", currency: "TRY", count: 2, amount: "1500.00" },
    { bucket: "SOON", kind: "RECEIVED", currency: "TRY", count: 1, amount: "600.00" },
    { bucket: "SOON", kind: "ISSUED", currency: "TRY", count: 1, amount: "500.00" },
    { bucket: "MONTH", kind: "RECEIVED", currency: "TRY", count: 1, amount: "300.00" },
    // ⚠️ PENCERE DIŞI (2027) — §5'in ölçtüğü satır budur.
    { bucket: "LATER", kind: "RECEIVED", currency: "TRY", count: 1, amount: "900.00" },
  ],
  weeks: [
    { key: "2026-08-10", start: "2026-08-10", end: "2026-08-16", kind: "RECEIVED", currency: "TRY", count: 1, amount: "600.00" },
    { key: "2026-08-10", start: "2026-08-10", end: "2026-08-16", kind: "ISSUED", currency: "TRY", count: 1, amount: "500.00" },
    { key: "2026-08-17", start: "2026-08-17", end: "2026-08-23", kind: "RECEIVED", currency: "TRY", count: 1, amount: "300.00" },
  ],
  months: [
    { key: "2026-08", start: "2026-08-01", end: "2026-08-31", kind: "RECEIVED", currency: "TRY", count: 2, amount: "900.00" },
    { key: "2026-08", start: "2026-08-01", end: "2026-08-31", kind: "ISSUED", currency: "TRY", count: 1, amount: "500.00" },
  ],
  liveStatuses: { RECEIVED: ["PORTFOLIO", "AT_BANK"], ISSUED: ["ISSUED"] },
  notes: ["Eksen VADE tarihidir.", "Ciro edilen çek girmez."],
};

/** Aynı fixture + USD satırı — karışık para birimi dalı. */
const MIXED: ChequeDueSummary = {
  ...BASE,
  weeks: [
    ...BASE.weeks,
    { key: "2026-08-10", start: "2026-08-10", end: "2026-08-16", kind: "RECEIVED", currency: "USD", count: 1, amount: "50.00" },
  ],
  months: [
    ...BASE.months,
    { key: "2026-08", start: "2026-08-01", end: "2026-08-31", kind: "RECEIVED", currency: "USD", count: 1, amount: "50.00" },
  ],
};

const weekTable = (d: ChequeDueSummary) => buildChequeDueExport(d).tables[1]!;

describe("çek vade takvimi dışa aktarımı", () => {
  // ---------------------------------------------------------------------------
  it("§1 Excel kolonları ile PDF başlıkları BİREBİR aynı (üç tablonun her biri)", () => {
    const spec = buildChequeDueExport(MIXED);
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);

    expect(sheets).toHaveLength(3);
    spec.tables.forEach((t, i) => {
      expect(sheets[i]!.columns.map((c) => c.header)).toEqual(t.columns.map((c) => c.header));
      for (const h of t.columns) expect(html).toContain(`>${h.header}</th>`);
    });
  });

  it("§1b PDF YATAY basılır (dokuz kolonun dördü para taşıyor; dikeyde sarıyordu)", () => {
    expect(buildChequeDueExport(BASE).orientation).toBe("landscape");
  });

  it("§1c backend'in kapsam notları OLDUĞU GİBİ taşınır (burada yeniden yazılmaz)", () => {
    const spec = buildChequeDueExport(BASE);
    for (const n of BASE.notes) expect(spec.meta).toContain(n);
    // Notlar Excel sayfasına da düşer — kırılım tek başına paylaşılıyor.
    expect(toSheets(spec)[0]!.notes ?? []).toEqual(expect.arrayContaining(BASE.notes));
  });

  // ---------------------------------------------------------------------------
  it("§2a ekranın başlıkları gerçekten okundu (körlük zemini)", () => {
    expect(SCREEN_HEADERS.length).toBeGreaterThanOrEqual(6);
    expect(SCREEN_HEADERS).toContain("Net");
    expect(SCREEN_HEADERS).toContain("Para");
  });

  it("§2b EKRANDA görünen her kolon DOSYADA da var (alias'lar yazılı)", () => {
    const specHeaders = weekTable(BASE).columns.map((c) => c.header);
    for (const h of SCREEN_HEADERS) {
      const accepted = HEADER_ALIAS[h] ?? [h];
      expect(
        accepted.some((a) => specHeaders.includes(a)),
        `ekranda "${h}" var, dışa aktarımda yok`,
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  it("§3a PARA BİRİMLERİ TOPLANMAZ: aynı hafta iki birimde iki AYRI satır", () => {
    const rows = foldCalendar(MIXED.weeks);
    const first = rows.filter((r) => r.key === "2026-08-10");
    expect(first.map((r) => r.currency)).toEqual(["TRY", "USD"]);
  });

  it("§3b NET yalnız aynı para biriminde: TRY 600−500=100, USD 50 (karışmadı)", () => {
    const rows = foldCalendar(MIXED.weeks);
    const tryRow = rows.find((r) => r.key === "2026-08-10" && r.currency === "TRY")!;
    const usdRow = rows.find((r) => r.key === "2026-08-10" && r.currency === "USD")!;
    expect(tryRow.receivedAmount).toBe(600);
    expect(tryRow.issuedAmount).toBe(500);
    expect(tryRow.net).toBe(100);
    expect(usdRow.net).toBe(50);
    expect(usdRow.issuedAmount).toBe(0);
  });

  it("§3c satırlar (dönem, para birimi) ile sıralı — dosya ve ekran aynı sırayı görür", () => {
    expect(foldCalendar(MIXED.weeks).map((r) => `${r.key}|${r.currency}`)).toEqual([
      "2026-08-10|TRY",
      "2026-08-10|USD",
      "2026-08-17|TRY",
    ]);
  });

  // ---------------------------------------------------------------------------
  it("§4a TEK para biriminde TOPLAM satırı yazılır ve doğru toplar", () => {
    const t = weekTable(BASE);
    expect(t.totalRow).toBeDefined();
    expect(t.totalRow!.currency).toBe("TRY");
    expect(t.totalRow!.ra).toBe(900);
    expect(t.totalRow!.ia).toBe(500);
    expect(t.totalRow!.net).toBe(400);
  });

  it("§4b ⭐ KARIŞIK para biriminde TOPLAM satırı YAZILMAZ (TL+USD toplamı yalan olurdu)", () => {
    expect(weekTable(MIXED).totalRow).toBeUndefined();
  });

  it("§4c SATIR YOKKEN toplam yazılmaz — 'TOPLAM 0' veri gelmemesini sıfır diye okuturdu", () => {
    const empty = weekTable({ ...BASE, weeks: [] });
    expect(empty.rows).toHaveLength(0);
    expect(empty.totalRow).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  it("§5 ⭐ KOVA TABLOSU portföyün TAMAMI: pencere dışındaki 'Sonrası' kovası dosyada DURUR", () => {
    const t = buildChequeDueExport(BASE).tables[0]!;
    expect(t.rows).toHaveLength(BASE.buckets.length);
    expect(t.rows.map((r) => r.bucket)).toContain(DUE_BUCKET_LABEL.LATER);
    // Kapsam farkı dosyanın İÇİNDE yazılı olmalı — rakamla aynı sayfada.
    expect((t.notes ?? []).join(" ")).toContain("TAMAMINI");
  });

  it("§5b pencere hem alt başlıkta hem takvim tablosunun notunda yazılı", () => {
    const spec = buildChequeDueExport(BASE);
    expect(spec.subtitle).toContain("14.08.2026");
    expect(spec.subtitle).toContain("13.09.2026");
    expect((spec.tables[1]!.notes ?? []).join(" ")).toContain("14.08.2026");
  });

  // ---------------------------------------------------------------------------
  it("§6 tutar/adet hücreleri SAYI (string girerse numFmt uygulanmaz, toplanamaz)", () => {
    const spec = buildChequeDueExport(BASE);
    for (const cell of ["count", "amount"]) {
      expect(typeof spec.tables[0]!.rows[0]![cell]).toBe("number");
    }
    for (const cell of ["rc", "ra", "ic", "ia", "net"]) {
      expect(typeof spec.tables[1]!.rows[0]![cell]).toBe("number");
    }
  });
});
