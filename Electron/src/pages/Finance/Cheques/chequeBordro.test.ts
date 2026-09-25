// =============================================================================
// ÇEK / SENET TESLİM BORDROSU BEKÇİSİ
// =============================================================================
// Ölçtüğü şeyler (K1 2026-09-26'dan beri kâğıt backend'de; burada SEÇİM kalır):
//  §3 AYNI YÖN kuralı — seçim katmanı sebebi söyler; "tümünü seç" atlanan satır
//     sayısını GERİ DÖNER; düğme kapısı (`bordroBlockReason`) aynı yüklemi taşır.
//  §4 İptal edilmiş kayıt bordroya giremez (ne seçilebilir ne istenebilir).
//  §5 Ara toplam şeridi — para birimi bazında, kuruşa yuvarlı.
//  §9 EKRAN DİKİŞİ (körlük zemini) — kural katmanının ekrandan gerçekten
//     çağrıldığı KAYNAKTAN doğrulanır ("yazıldı ama mount edilmedi" sınıfı).
//
// NEGATİF SONDA (boz-ölç-geri yükle; `cp` yedeği + `shasum`):
//   • `selectionBlockReason`ın yön dalı silindi → 2 kırmızı: §3b · §3c.
//   • `bordroBlockReason`ın YÖN dalı silindi → 1 kırmızı: §3d.
//   • `<ChequeBordroDialog>` mount'u kaldırıldı → 1 kırmızı: §9c.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BORDRO_EMPTY_ERROR,
  BORDRO_MIXED_KIND_ERROR,
  bordroBlockReason,
  selectAllIds,
  selectionBlockReason,
  selectionKind,
  totalsByCurrency,
} from "./chequeBordro";
import type { ChequeRow } from "./service";

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

const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("çek/senet teslim bordrosu", () => {
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

  it("§3d düğme kapısı karışık yönü ve boş seçimi SEBEBİYLE reddeder", () => {
    expect(bordroBlockReason([ROW(), ISSUED()])).toBe(BORDRO_MIXED_KIND_ERROR);
    expect(bordroBlockReason([])).toBe(BORDRO_EMPTY_ERROR);
    expect(bordroBlockReason([ROW()])).toBeNull();
    expect(bordroBlockReason([ISSUED(), ISSUED({ id: "c4", docNo: "CK4" })])).toBeNull();
  });

  // ---------------------------------------------------------------------------
  it("§4 İPTAL edilmiş kayıt bordroya giremez — ne seçilir ne üretilir", () => {
    const cancelled = ROW({ id: "cX", docNo: "CKX", status: "CANCELLED" });
    expect(selectionBlockReason(cancelled, null)).toContain("İptal");
    expect(selectionBlockReason(cancelled, "RECEIVED")).toContain("İptal");
    expect(bordroBlockReason([ROW(), cancelled])).toContain("iptal edilmiş kayıt");
    // "Tümünü seç" de onu atlar ve atlandığını söyler.
    const all = selectAllIds([ROW(), cancelled], null);
    expect(all.ids).toEqual(["c1"]);
    expect(all.skipped).toBe(1);
  });

  // ---------------------------------------------------------------------------
  it("§5 ara toplam şeridi: para birimi bazında adet + kuruşa yuvarlı toplam", () => {
    expect(totalsByCurrency([ROW(), ROW({ id: "c8", docNo: "CK8", currency: "USD", amount: "100" })])).toEqual([
      { currency: "TRY", count: 1, total: 12500.5 },
      { currency: "USD", count: 1, total: 100 },
    ]);
    // 0.30000000000000004 DEĞİL
    expect(totalsByCurrency([ROW({ amount: "0.1" }), ROW({ id: "c7", docNo: "CK7", amount: "0.2" })])[0]!.total).toBe(0.3);
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
    expect(dialog).toContain("deliveryNoteBlockReason");
    // Kâğıt panelde KURULMAZ — backend taslağı/belgeyi basar.
    expect(dialog).not.toContain("<!doctype");
    expect(dialog).not.toContain("ReportExportSpec");
  });
});
