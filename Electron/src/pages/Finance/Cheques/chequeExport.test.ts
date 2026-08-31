// =============================================================================
// ÇEK / SENET PORTFÖY DIŞA AKTARIM BEKÇİSİ
// =============================================================================
// Ölçtüğü şeyler:
//  §1 Excel ↔ PDF kolon eşitliği (tek spec sözleşmesi).
//  §2 EKRAN ↔ SPEC eşlemesi — `ChequeTable`ın `<thead>`'i KAYNAKTAN okunur ve
//     her ekran başlığının hangi dosya kolon(lar)ına açıldığı BURADA yazılıdır.
//     Tabloya kolon eklenirse ya da dosyadan kolon düşerse test kırmızı verir;
//     bu, "ekranda var, dosyada yok" sınıfını yakalayan tek mekanik kontroldür.
//  §3 İşlem/keşide tarihi ayrımı (SINIF 1) — tek hücreye katlanmadığı doğrulanır.
//  §4 Aktif süzgeç özeti kapakta.
//  §5-§8 Boş liste · iptal kaydı · karışık para birimi · kırpma notu.
//
// ⚠️ §1 TEK BAŞINA YETMEZ (ölçüldü): kolon spec'ten düşünce Excel ile PDF onu
// BİRLİKTE kaybeder ve §1 yeşil kalır. Ekran karşılaştırmasını yapan §2'dir.
//
// NEGATİF SONDA (boz-ölç-geri yükle, TEK zincir; yeni dosyada `git checkout`
// ÇALIŞMAZ → `cp` yedeği + shasum ile geri yükleme doğrulandı) — ÖLÇÜLEN sonuçlar:
//   • `COLUMNS`ten "İşlem tarihi" SİLİNDİ → 2 kırmızı (§2b, §3).
//     ⚠️ İLK YAZIMDA §3 KÖRDÜ: yalnız satır sözlüğündeki `postingDate` alanına
//     bakıyordu ve kolon düşünce alan yerinde durduğu için YEŞİL kalmıştı
//     (sonda 1 kırmızı verdi). §3 artık kolonun kendisini de arıyor.
//   • `counted` süzgeci `status !== "CANCELLED"` yerine tüm satırlar → 1 kırmızı (§6).
//   • Karışık para biriminde `amount` toplamı yazıldı → 1 kırmızı (§7).
//   • `sum2` kuruşa yuvarlamayı bıraktı (düz `reduce`) → 1 kırmızı (§7c).
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "@/pages/Reports/_components/reportExport";
import { buildChequeExport, chequeFilterSummary, statusFilterLabel } from "./chequeExport";
import { EMPTY_FILTERS, LIVE_STATUS, type ChequeFilterState } from "./ChequeFilterBar";
import type { ChequeRow } from "./service";

/**
 * EKRAN BAŞLIĞI → DOSYA KOLONLARI.
 *
 * Tek yönlü bir liste DEĞİL, SÖZLEŞME: solda `ChequeTable`ın kolonları (kaynaktan
 * okunanlarla birebir eşleşmek zorunda), sağda o hücrenin dosyada açıldığı
 * kolonlar (spec ile birebir eşleşmek zorunda). Ekranda tek hücrede duran iki
 * verinin Excel'de ayrı kolon olmasının gerekçesi `chequeExport.ts` başlığında.
 */
const HEADER_MAP: Array<[string, string[]]> = [
  ["Belge No", ["Belge No", "Seri No"]],
  ["Tür", ["Tür", "Yön"]],
  ["Cari", ["Cari", "Ciro edilen"]],
  ["Keşideci / Banka", ["Keşideci", "Banka"]],
  ["İşlem / Keşide", ["İşlem tarihi", "Keşide tarihi"]],
  ["Vade", ["Vade", "Vade durumu"]],
  ["Durum", ["Durum", "Bulunduğu banka"]],
  // Tutar hücresi ekranda üç şey basıyor: tutar (para birimi sembollü),
  // TL karşılığı ve "Faturaya kapatıldı" ibaresi.
  ["Tutar", ["Para", "Tutar", "TL karşılığı", "Faturaya kapatılan"]],
];

function tableHeaders(relPath: string): string[] {
  const src = readFileSync(resolve(__dirname, relPath), "utf8");
  const thead = /<thead[\s\S]*?<\/thead>/.exec(src)?.[0] ?? "";
  return [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter(Boolean);
}

const SCREEN_HEADERS = tableHeaders("./ChequeTable.tsx");

const ROW = (over: Partial<ChequeRow> = {}): ChequeRow => ({
  id: "c1",
  docNo: "CK1408260001",
  kind: "RECEIVED",
  docType: "CHEQUE",
  status: "PORTFOLIO",
  currency: "TRY",
  amount: "12500.5",
  amountTry: "12500.5",
  postingDate: "2026-08-14T00:00:00.000Z",
  issueDate: "2026-08-10T00:00:00.000Z",
  // ⚠️ UZAK gelecek: "Vade durumu" BUGÜNE göre hesaplanır ve yakın bir tarih
  // seçmek testi takvime bağlı (belli bir haftadan sonra kırılan) hale getirirdi.
  dueDate: "2030-12-31T00:00:00.000Z",
  serialNo: "A-0099",
  bankName: "Ziraat",
  drawerName: "MEHMET & OĞULLARI",
  allocatedTotal: "0",
  bankAccount: null,
  cari: { id: "k1", customer: { code: "M-1", name: "PATOS TEKSTİL" }, subcontractor: null },
  endorsedToCari: null,
  ...over,
});

const FILTERS = (over: Partial<ChequeFilterState> = {}): ChequeFilterState => ({
  ...EMPTY_FILTERS,
  ...over,
});

const build = (rows: ChequeRow[], filters = FILTERS(), total = rows.length) =>
  buildChequeExport({ rows, filters, total });

const table = (rows: ChequeRow[], filters = FILTERS(), total = rows.length) =>
  build(rows, filters, total).tables[0]!;

describe("çek/senet portföyü dışa aktarımı", () => {
  // ---------------------------------------------------------------------------
  it("§1 Excel kolonları ile PDF başlıkları BİREBİR aynı", () => {
    const spec = build([ROW()]);
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);
    const cols = spec.tables[0]!.columns.map((c) => c.header);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.columns.map((c) => c.header)).toEqual(cols);
    for (const h of cols) expect(html).toContain(`>${h}</th>`);
  });

  // ---------------------------------------------------------------------------
  it("§2 ekran başlıkları gerçekten okundu (körlük zemini)", () => {
    // Regex boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkar.
    expect(SCREEN_HEADERS.length).toBeGreaterThanOrEqual(8);
    expect(SCREEN_HEADERS).toContain("Tutar");
    // Aksiyon sütunu (`<th … />`) metin taşımaz → eşlenmemeli.
    expect(SCREEN_HEADERS).not.toContain("");
  });

  it("§2a eşleme SOLU: ChequeTable'ın her kolonu eşlenmiş (fazlası da yok)", () => {
    expect(HEADER_MAP.map(([screen]) => screen)).toEqual(SCREEN_HEADERS);
  });

  it("§2b eşleme SAĞI: dosyanın kolonları eşlemenin AÇILIMIYLA birebir", () => {
    const expected = HEADER_MAP.flatMap(([, cols]) => cols);
    expect(table([ROW()]).columns.map((c) => c.header)).toEqual(expected);
  });

  // ---------------------------------------------------------------------------
  it("§3 İŞLEM ve KEŞİDE ayrı kolonlardır ve ayrı değerler taşır", () => {
    const t = table([ROW()]);
    // ⚠️ Satırdaki alanı doğrulamak YETMEZ: kolon düşerse veri sözlükte kalır
    // ama dosyaya HİÇ basılmaz. Kolonun kendisi de aranır.
    const heads = t.columns.map((c) => c.header);
    expect(heads).toContain("İşlem tarihi");
    expect(heads).toContain("Keşide tarihi");
    expect(t.columns.filter((c) => c.key === "postingDate" || c.key === "issueDate")).toHaveLength(2);

    const r = t.rows[0]!;
    expect(r.postingDate).toBe("14.08.2026");
    expect(r.issueDate).toBe("10.08.2026");
    expect(r.postingDate).not.toBe(r.issueDate);
  });

  it("§3c vade durumu satırda yazıyla da durur (renk tek başına erişilebilir değil)", () => {
    // Geçmiş vade + CANLI durum → "vadesi geçti"; kapanmış çekte uyarı YOK
    // (iş bitmiştir, kırmızı denizi üretmez — `dates.dueTone` kuralı).
    const past = "2020-01-01T00:00:00.000Z";
    expect(table([ROW({ dueDate: past })]).rows[0]!.dueHint).toBe("vadesi geçti");
    expect(table([ROW({ dueDate: past, status: "COLLECTED" })]).rows[0]!.dueHint).toBe("");
  });

  it("§3b işlem tarihi liste ucunda yoksa hücre BOŞ kalır ve sebebi NOT olarak yazılır", () => {
    const t = table([ROW({ postingDate: undefined })]);
    expect(t.rows[0]!.postingDate).toBe(""); // "—" DEĞİL: Excel'de kolonu metne çevirir
    expect(t.notes?.some((n) => n.includes("liste ucundan gelmiyor"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  it("§4 aktif süzgeçler kapakta — varsayılan 'canlı olanlar' DA yazılır", () => {
    expect(build([ROW()]).subtitle).toBe("Durum: Canlı olanlar");

    const spec = build(
      [ROW()],
      FILTERS({ status: "AT_BANK", kind: "RECEIVED", docType: "PROMISSORY_NOTE", currency: "USD", dueFrom: "2026-08-01", dueTo: "2026-08-31", search: "ziraat" }),
    );
    expect(spec.subtitle).toBe(
      "Durum: Bankada (tahsilde) · Yön: Aldığımız · Tür: Senet · Para: USD · Vade: 01.08.2026 – 31.08.2026 · Arama: “ziraat”",
    );
  });

  it("§4b kova karosundan gelen CSV durum da okunur adla basılır (ham enum değil)", () => {
    expect(statusFilterLabel("")).toBe("Tümü (geçmiş dahil)");
    expect(statusFilterLabel(LIVE_STATUS)).toBe("Canlı olanlar");
    expect(statusFilterLabel("PORTFOLIO,AT_BANK")).toBe("Elimizde + Bankada (tahsilde)");
    // Tanınmayan değer sessizce yutulmaz, ham basılır.
    expect(statusFilterLabel("YENI_DURUM")).toBe("YENI_DURUM");
    expect(chequeFilterSummary(FILTERS())).toEqual(["Durum: Canlı olanlar"]);
  });

  // ---------------------------------------------------------------------------
  it("§5 boş liste: TOPLAM satırı BASILMAZ, çıktı yolu yine de düşmez", () => {
    const t = table([]);
    expect(t.rows).toEqual([]);
    expect(t.totalRow).toBeUndefined();
    expect(buildReportHtml(build([]))).toContain("Çek ve Senet Portföyü");
  });

  // ---------------------------------------------------------------------------
  it("§6 İPTAL edilen kayıt listede DURUR ama TOPLAMA girmez", () => {
    const t = table([ROW(), ROW({ id: "c2", docNo: "CK1408260002", status: "CANCELLED", amount: "999", amountTry: "999" })]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]!.status).toBe("İptal");
    expect(t.totalRow?.amount).toBe(12500.5); // 999 dahil DEĞİL
    expect(t.totalRow?.amountTry).toBe(12500.5);
    expect(String(t.totalRow?.status)).toContain("1 kayıt");
    expect(t.notes?.some((n) => n.includes("1 iptal kaydını KAPSAMAZ"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  it("§7 karışık para biriminde 'Tutar' toplamı YAZILMAZ; TL karşılığı toplanır", () => {
    const t = table([ROW(), ROW({ id: "c3", docNo: "CK1408260003", currency: "USD", amount: "100", amountTry: "4000" })]);
    expect(t.totalRow?.amount).toBe("");
    expect(t.totalRow?.allocated).toBe("");
    expect(t.totalRow?.currency).toBe("");
    expect(t.totalRow?.amountTry).toBe(16500.5);
    expect(t.notes?.some((n) => n.includes("farklı para birimlerini toplamak anlamsızdır"))).toBe(true);
  });

  it("§7c toplam KURUŞA yuvarlanır (ham reduce ikili kayan nokta artığı üretir)", () => {
    const t = table([ROW({ amount: "0.1", amountTry: "0.1" }), ROW({ id: "c9", docNo: "CK9", amount: "0.2", amountTry: "0.2" })]);
    expect(t.totalRow?.amount).toBe(0.3); // 0.30000000000000004 DEĞİL
    expect(t.totalRow?.amountTry).toBe(0.3);
  });

  it("§7b tek para biriminde toplam yazılır ve para birimi TOPLAM satırında görünür", () => {
    const t = table([ROW(), ROW({ id: "c4", docNo: "CK1408260004", amount: "500", amountTry: "500", allocatedTotal: "250" })]);
    expect(t.totalRow?.amount).toBe(13000.5);
    expect(t.totalRow?.allocated).toBe(250);
    expect(t.totalRow?.currency).toBe("TRY");
  });

  // ---------------------------------------------------------------------------
  it("§8 sunucu toplamı gösterilenden büyükse KIRPMA notu basılır", () => {
    const t = table([ROW()], FILTERS(), 250);
    expect(t.notes?.some((n) => n.includes("250 kaydın ilk 1 tanesi"))).toBe(true);
    expect(build([ROW()], FILTERS(), 250).meta?.[0]).toBe("Kayıt: 1 / 250");
    // Kırpma yoksa not da yok, sayaç da sade.
    expect(table([ROW()]).notes?.some((n) => n.includes("TAM LİSTE DEĞİLDİR"))).toBe(false);
    expect(build([ROW()]).meta?.[0]).toBe("Kayıt: 1");
  });

  it("§8b serbest metin keşideci adı PDF'i bozmaz (kaçırma)", () => {
    expect(buildReportHtml(build([ROW()]))).toContain("MEHMET &amp; OĞULLARI");
  });

  it("§9 tutarlar Excel'e SAYI gider; kapama yoksa hücre boş", () => {
    const r = table([ROW()]).rows[0]!;
    expect(typeof r.amount).toBe("number");
    expect(r.amount).toBe(12500.5);
    expect(r.allocated).toBe("");
    const cols = table([ROW()]).columns;
    for (const key of ["amount", "amountTry", "allocated"]) {
      expect(cols.find((c) => c.key === key)?.numFmt).toBe("#,##0.00");
      expect(cols.find((c) => c.key === key)?.align).toBe("right");
    }
  });
});
