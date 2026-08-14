// =============================================================================
// ÇEK / SENET TESLİM BORDROSU BEKÇİSİ
// =============================================================================
// Ölçtüğü şeyler:
//  §1 Tek spec sözleşmesi — Excel kolonları ile PDF/Yazdır başlıkları BİREBİR.
//  §2 Kolon kümesi + SIRA + satır değerleri (sıra numarası 1…N, boş alan "" ).
//  §3 AYNI YÖN kuralı — üretici fail-closed REDDEDER; seçim katmanı sebebi söyler;
//     "tümünü seç" atlanan satır sayısını GERİ DÖNER.
//  §4 İptal edilmiş kayıt bordroya giremez (ne seçilebilir ne üretilebilir).
//  §5 Toplam — tek para biriminde yazılır ve KURUŞA yuvarlanır; karışık para
//     biriminde TEK TOPLAM BASILMAZ ve sebebi nota düşer.
//  §6 Adet + para birimi bazlı toplam her durumda notta.
//  §7 İmza satırları + "anlık çıktı" cümlesi kâğıtta.
//  §8 Boş seçim reddi · opsiyonel teslim yeri.
//  §9 EKRAN DİKİŞİ (körlük zemini) — kural katmanının ekrandan gerçekten
//     çağrıldığı KAYNAKTAN doğrulanır. Kuralı yazıp ekranı bağlamamak, bu
//     projede adı konmuş bir hata sınıfıdır ("yazıldı ama mount edilmedi").
//
// NEGATİF SONDA (boz-ölç-geri yükle, TEK zincir; yeni dosyada `git checkout`
// ÇALIŞMAZ → `cp` yedeği + `shasum` ile geri yükleme doğrulandı). ÖLÇÜM ÇIKIŞ
// KODUNDANDIR; dördü de `exit 1` verdi:
//   • `bordroBlockReason`ın YÖN dalı (`new Set(kinds).size > 1`) silindi
//     → 2 kırmızı: §3a (üretici reddi) · §3d (ekran ile üretici aynı yüklem).
//     ⚠️ §3b/§3c YEŞİL KALDI ve bu BİLİNÇLİ: kural İKİ katmanda yaşıyor ve bu
//     sonda yalnız üretici katmanını bozuyor. Tek sondayla yetinilseydi seçim
//     katmanının bekçisiz olduğu görülmezdi → ikinci sonda:
//   • `selectionBlockReason`ın yön dalı silindi → 2 kırmızı: §3b · §3c.
//   • Karışık para biriminde toplam koşulsuz yazıldı → 1 kırmızı: §5c.
//   • `<ChequeBordroDialog>` mount'u kaldırıldı ("yazıldı ama bağlanmadı"
//     sınıfı) → 1 kırmızı: §9c.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReportHtml, toSheets } from "@/pages/Reports/_components/reportExport";
import {
  BORDRO_EMPTY_ERROR,
  BORDRO_MIXED_KIND_ERROR,
  bordroBlockReason,
  buildChequeBordro,
  selectAllIds,
  selectionBlockReason,
  selectionKind,
  totalsByCurrency,
} from "./chequeBordro";
import type { ChequeRow } from "./service";

/** İSTENEN KOLONLAR — sıra dahil sözleşmedir (yol haritası H6). */
const EXPECTED_COLUMNS = [
  "Sıra",
  "Belge No",
  "Seri No",
  "Keşide",
  "Vade",
  "Keşideci",
  "Banka",
  "Para",
  "Tutar",
];

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
  // ⚠️ UZAK gelecek: yakın bir vade testi takvime bağlı hale getirirdi.
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

const ISSUED = (over: Partial<ChequeRow> = {}): ChequeRow =>
  ROW({ id: "c2", docNo: "CK1408260002", kind: "ISSUED", ...over });

const DATE = "2026-08-14";
const build = (rows: ChequeRow[], place?: string) =>
  buildChequeBordro({ rows, place, dateYmd: DATE });
const table = (rows: ChequeRow[], place?: string) => build(rows, place).tables[0]!;

const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("çek/senet teslim bordrosu", () => {
  // ---------------------------------------------------------------------------
  it("§1 Excel kolonları ile PDF başlıkları BİREBİR aynı (tek spec)", () => {
    const spec = build([ROW()]);
    const sheets = toSheets(spec);
    const html = buildReportHtml(spec);
    const cols = spec.tables[0]!.columns.map((c) => c.header);

    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.columns.map((c) => c.header)).toEqual(cols);
    for (const h of cols) expect(html).toContain(`>${h}</th>`);
  });

  // ---------------------------------------------------------------------------
  it("§2 kolonlar istenen küme ve SIRADA", () => {
    expect(table([ROW()]).columns.map((c) => c.header)).toEqual(EXPECTED_COLUMNS);
  });

  it("§2b satır değerleri — sıra 1…N, tutar SAYI, boş alan '' (Excel'de '—' kolonu metne çevirir)", () => {
    const t = table([ROW(), ROW({ id: "c9", docNo: "CK9", serialNo: null, drawerName: null, bankName: null })]);
    expect(t.rows.map((r) => r.no)).toEqual([1, 2]);
    expect(t.rows[0]!.docNo).toBe("CK1408260001");
    expect(t.rows[0]!.serialNo).toBe("A-0099");
    expect(t.rows[0]!.issueDate).toBe("10.08.2026");
    expect(t.rows[0]!.dueDate).toBe("31.12.2030");
    expect(t.rows[0]!.drawer).toBe("MEHMET & OĞULLARI");
    expect(t.rows[0]!.bank).toBe("Ziraat");
    expect(t.rows[0]!.currency).toBe("TRY");
    expect(typeof t.rows[0]!.amount).toBe("number");
    expect(t.rows[0]!.amount).toBe(12500.5);
    // Boş alanlar "—" DEĞİL, "" olmalı.
    expect(t.rows[1]!.serialNo).toBe("");
    expect(t.rows[1]!.drawer).toBe("");
    expect(t.rows[1]!.bank).toBe("");
    // Tutar kolonu para biçimli ve sağa yaslı.
    const amountCol = t.columns.find((c) => c.key === "amount");
    expect(amountCol?.numFmt).toBe("#,##0.00");
    expect(amountCol?.align).toBe("right");
  });

  it("§2c serbest metin keşideci adı PDF'i bozmaz (kaçırma)", () => {
    expect(buildReportHtml(build([ROW()]))).toContain("MEHMET &amp; OĞULLARI");
  });

  // ---------------------------------------------------------------------------
  it("§3a KARIŞIK YÖN üretici tarafından REDDEDİLİR (fail-closed, sessiz null değil)", () => {
    const mixed = [ROW(), ISSUED()];
    expect(() => build(mixed)).toThrow(BORDRO_MIXED_KIND_ERROR);
    // Tek yön geçer — kural "her karışıklığı reddet" değil, "yön birdir".
    expect(() => build([ROW(), ROW({ id: "c3", docNo: "CK3" })])).not.toThrow();
    expect(() => build([ISSUED(), ISSUED({ id: "c4", docNo: "CK4" })])).not.toThrow();
  });

  it("§3b seçim katmanı: ilk seçim YÖNÜ KİLİTLER, karşı yön sebebiyle kapanır", () => {
    expect(selectionKind([])).toBeNull();
    expect(selectionKind([ROW()])).toBe("RECEIVED");

    // Kilit yokken her iki yön de serbest.
    expect(selectionBlockReason(ROW(), null)).toBeNull();
    expect(selectionBlockReason(ISSUED(), null)).toBeNull();

    // Kilit varken karşı yön kapanır VE sebep yazılı döner.
    expect(selectionBlockReason(ROW(), "RECEIVED")).toBeNull();
    const reason = selectionBlockReason(ISSUED(), "RECEIVED");
    expect(reason).toBeTruthy();
    expect(reason).toContain("tek yön");
  });

  it("§3c 'tümünü seç' tek yöne uyar ve ATLANAN sayısını geri döner", () => {
    const rows = [ROW(), ISSUED(), ROW({ id: "c5", docNo: "CK5" })];
    const all = selectAllIds(rows, null);
    expect(all.kind).toBe("RECEIVED"); // ilk uygun satırın yönü kilit olur
    expect(all.ids).toEqual(["c1", "c5"]);
    expect(all.skipped).toBe(1); // sessiz kısmi seçim YOK

    // Kilit verilirse ona uyar (ilk satırın yönüne SAPMAZ).
    const locked = selectAllIds(rows, "ISSUED");
    expect(locked.ids).toEqual(["c2"]);
    expect(locked.skipped).toBe(2);

    // Seçilecek satır yoksa kilit de kurulmaz.
    expect(selectAllIds([], null)).toEqual({ ids: [], kind: null, skipped: 0 });
  });

  it("§3d ekran ile üretici AYNI yüklemi kullanır (ayrışırsa düğme 'yapılabilir' der, üretim patlar)", () => {
    const mixed = [ROW(), ISSUED()];
    expect(bordroBlockReason(mixed)).toBe(BORDRO_MIXED_KIND_ERROR);
    expect(() => build(mixed)).toThrow(bordroBlockReason(mixed)!);
    expect(bordroBlockReason([ROW()])).toBeNull();
  });

  // ---------------------------------------------------------------------------
  it("§4 İPTAL edilmiş kayıt bordroya giremez — ne seçilir ne üretilir", () => {
    const cancelled = ROW({ id: "cX", docNo: "CKX", status: "CANCELLED" });
    expect(selectionBlockReason(cancelled, null)).toContain("İptal");
    expect(selectionBlockReason(cancelled, "RECEIVED")).toContain("İptal");
    expect(bordroBlockReason([ROW(), cancelled])).toContain("iptal edilmiş kayıt");
    expect(() => build([ROW(), cancelled])).toThrow(/iptal/i);
    // "Tümünü seç" de onu atlar ve atlandığını söyler.
    const all = selectAllIds([ROW(), cancelled], null);
    expect(all.ids).toEqual(["c1"]);
    expect(all.skipped).toBe(1);
  });

  // ---------------------------------------------------------------------------
  it("§5 tek para biriminde TOPLAM yazılır ve para birimi toplam satırında görünür", () => {
    const t = table([ROW(), ROW({ id: "c6", docNo: "CK6", amount: "500" })]);
    expect(t.totalRow?.amount).toBe(13000.5);
    expect(t.totalRow?.currency).toBe("TRY");
    expect(String(t.totalRow?.docNo)).toContain("2 adet");
  });

  it("§5b toplam KURUŞA yuvarlanır (ham reduce ikili kayan nokta artığı üretir)", () => {
    const t = table([ROW({ amount: "0.1" }), ROW({ id: "c7", docNo: "CK7", amount: "0.2" })]);
    expect(t.totalRow?.amount).toBe(0.3); // 0.30000000000000004 DEĞİL
  });

  it("§5c KARIŞIK para biriminde TEK TOPLAM BASILMAZ ve sebebi notta", () => {
    const t = table([ROW(), ROW({ id: "c8", docNo: "CK8", currency: "USD", amount: "100" })]);
    expect(t.totalRow?.amount).toBe("");
    expect(t.totalRow?.currency).toBe("");
    // Adet yine yazılır — kaç kâğıt teslim edildiği para biriminden bağımsızdır.
    expect(String(t.totalRow?.docNo)).toContain("2 adet");
    expect(t.notes?.some((n) => n.includes("farklı para birimlerini toplamak anlamsızdır"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  it("§6 adet + para birimi bazlı toplam HER DURUMDA notta", () => {
    expect(totalsByCurrency([ROW(), ROW({ id: "c8", docNo: "CK8", currency: "USD", amount: "100" })])).toEqual([
      { currency: "TRY", count: 1, total: 12500.5 },
      { currency: "USD", count: 1, total: 100 },
    ]);

    const single = table([ROW()]);
    expect(single.notes?.some((n) => n.includes("TRY: 1 adet · 12.500,50"))).toBe(true);

    const mixed = table([ROW(), ROW({ id: "c8", docNo: "CK8", currency: "USD", amount: "100" })]);
    const line = mixed.notes?.find((n) => n.startsWith("Para birimi bazında toplam"));
    expect(line).toContain("TRY: 1 adet · 12.500,50");
    expect(line).toContain("USD: 1 adet · 100,00");
  });

  // ---------------------------------------------------------------------------
  it("§7 imza satırları ve 'anlık çıktı' cümlesi KÂĞITTA (meta/notes ile, el yapımı HTML değil)", () => {
    const spec = build([ROW()]);
    const notes = spec.tables[0]!.notes ?? [];
    expect(notes.some((n) => n.startsWith("Teslim Eden"))).toBe(true);
    expect(notes.some((n) => n.startsWith("Teslim Alan"))).toBe(true);
    expect(spec.meta?.some((m) => m.includes("ANLIK"))).toBe(true);
    expect(spec.meta?.some((m) => m.includes("belge numarası"))).toBe(true);
    // Üç çıktının hepsinde görünmeli (Excel `toSheets` meta+notes'u birleştirir).
    const html = buildReportHtml(spec);
    expect(html).toContain("Teslim Eden");
    expect(html).toContain("ANLIK");
    const sheetNotes = toSheets(spec)[0]!.notes ?? [];
    expect(sheetNotes.some((n) => n.includes("ANLIK"))).toBe(true);
    expect(sheetNotes.some((n) => n.startsWith("Teslim Alan"))).toBe(true);
  });

  it("§7b başlık yönü ve tarihi söyler; çok kolonlu çıktı YATAY basılır", () => {
    expect(build([ROW()]).subtitle).toBe("Aldığımız çek/senet · 14.08.2026");
    expect(build([ISSUED()]).subtitle).toBe("Verdiğimiz çek/senet · 14.08.2026");
    expect(build([ROW()]).orientation).toBe("landscape");
    expect(build([ROW()]).meta?.[0]).toBe("Adet: 1");
  });

  // ---------------------------------------------------------------------------
  it("§8 boş seçim reddedilir; teslim yeri OPSİYONEL ve boşsa satır BASILMAZ", () => {
    expect(bordroBlockReason([])).toBe(BORDRO_EMPTY_ERROR);
    expect(() => build([])).toThrow(BORDRO_EMPTY_ERROR);

    expect(build([ROW()]).meta?.some((m) => m.startsWith("Teslim edilen"))).toBe(false);
    expect(build([ROW()], "   ").meta?.some((m) => m.startsWith("Teslim edilen"))).toBe(false);
    expect(build([ROW()], "Ziraat Bankası — Merkez").meta).toContain(
      "Teslim edilen yer / banka: Ziraat Bankası — Merkez",
    );
  });

  // ---------------------------------------------------------------------------
  // §9 EKRAN DİKİŞİ — kural katmanı ekrandan GERÇEKTEN çağrılıyor mu.
  // Kaynak taraması; körlük zemini olmadan "ihlal yok" ile "hiçbir şeye
  // bakılmadı" aynı yeşile çıkar (dosya okunamazsa `readFileSync` fırlatır).
  // ---------------------------------------------------------------------------
  it("§9a seçim sütunu tabloda çizilir ve seçilemeyen kutu SEBEBİYLE kapanır", () => {
    const table$ = src("./ChequeTable.tsx");
    expect(table$.length).toBeGreaterThan(2000);
    expect(table$).toContain("Checkbox");
    expect(table$).toContain("selection.onToggle");
    expect(table$).toContain("selection.onToggleAll");
    // Kapalı kutunun sebebi ekranda: `title`/`aria-label` blockReason'dan gelir.
    expect(table$).toContain("selectBlock");
    expect(/disabled=\{selectBlock !== null\}/.test(table$)).toBe(true);
  });

  it("§9b seçim sütununun BAŞLIĞI metinsizdir (chequeExport §2 eşlemesine girmemeli)", () => {
    // `chequeExport.test.ts` §2 `<thead>`'i kaynaktan okuyup dosya kolonlarıyla
    // eşliyor; seçim kutusu bir veri kolonu DEĞİLDİR. Metinli bir başlık o
    // sözleşmeyi (bizim değil, KOMŞU bekçinin) sessizce kırardı.
    const thead = /<thead[\s\S]*?<\/thead>/.exec(src("./ChequeTable.tsx"))?.[0] ?? "";
    expect(thead).toContain("Checkbox");
    const headers = [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => (m[1] ?? "").trim());
    expect(headers).not.toContain("Seç");
    expect(headers).toEqual([
      "Belge No",
      "Tür",
      "Cari",
      "Keşideci / Banka",
      "İşlem / Keşide",
      "Vade",
      "Durum",
      "Tutar",
    ]);
  });

  it("§9c sayfa kural katmanını ÇAĞIRIR (kopyalamaz) ve bordro diyaloğunu mount eder", () => {
    const page = src("./ChequesPage.tsx");
    expect(page.length).toBeGreaterThan(4000);
    expect(page).toContain('from "./chequeBordro"');
    expect(page).toContain("selectionBlockReason");
    expect(page).toContain("selectionKind");
    expect(page).toContain("selectAllIds");
    expect(page).toContain("<ChequeBordroDialog");
    // Seçim filtre değişiminde temizlenir (bkz. ChequesPage başlığı).
    expect(page).toContain("setSelectedIds(new Set())");

    const dialog = src("./ChequeBordroDialog.tsx");
    expect(dialog.length).toBeGreaterThan(1500);
    expect(dialog).toContain("buildChequeBordro");
    expect(dialog).toContain("bordroBlockReason");
    // Üç çıktı ORTAK şeritten — bordroya özel el yapımı HTML yok.
    expect(dialog).toContain("ReportExportBar");
    expect(dialog).not.toContain("<!doctype");
  });
});
