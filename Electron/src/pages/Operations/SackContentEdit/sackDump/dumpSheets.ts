import type { SackDumpNameMode } from "@/lib/shipping-flags";
// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — Excel sayfaları (buildWorkbook girdisi)
// =============================================================================
// Dosya düzeni: TEK .xlsx, ÇUVAL BAŞINA BİR SAYFA.
//   • "Özet"       — çuval başına bir satır (müşteri/şube/kg/not) + TOPLAM
//   • <ÇuvalNo>    — o çuvalın top satırları + TOPLAM
//   • "Kartelalar" — yalnız kartela varsa; tüm çuvalların kartelaları tek listede
//
// Neden çuval meta'sı Özet'te: `SheetSpec` tek bir kolon kümesi taşır, bir sayfaya
// hem "çuval bilgisi bloğu" hem "top tablosu" sığmaz. Bu yüzden meta Özet'te
// toplanır, top detayı kendi sayfasında kalır — `buildWorkbook` genişletilmez.
// Tek çuvalda da Özet üretilir: müşteri/şube/kg/not başka hiçbir sayfada yok.
// =============================================================================

import type { SheetSpec } from "@/lib/xlsx-export";
import { dumpTotalQty, type SackDump, type SackDumpOptions } from "./types";

/** Metre/kg 3 ondalık (backend Decimal(x,3)); sondaki sıfırlar gizli. */
const QTY_FMT = "#,##0.###";
const INT_FMT = "#,##0";

/** Excel sayfa adı: ≤31 karakter + `: \ / ? * [ ]` yasak (buildWorkbook da sanitize
 *  eder; burada MÜKERRER AD çözümü için önceden normalize ediyoruz). */
const sheetBase = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

/**
 * Çuval no'lar teoride benzersiz ama döküm ADI üzerinden sayfa ürettiği için
 * (kırpma sonrası) çakışma olabilir → " (2)" ekiyle ayrıştır. exceljs aynı adlı
 * ikinci sayfada patlar; sessiz veri kaybı yerine ad değiştirilir.
 */
function uniqueSheetName(base: string, used: Set<string>): string {
  const name = sheetBase(base) || "Çuval";
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return name; // ulaşılamaz (1000 mükerrer ad)
}

/** Özet sayfası — çuval başına bir satır. */
function summarySheet(dumps: SackDump[], withNotes: boolean): SheetSpec {
  const columns = [
    { header: "Çuval No", key: "sackNo", width: 18 },
    { header: "Müşteri", key: "customer", width: 28 },
    { header: "Şube", key: "branch", width: 20 },
    { header: "İhracat Kodu", key: "branchCode", width: 14 },
    { header: "Top", key: "rollCount", width: 8, numFmt: INT_FMT },
    { header: "Metre", key: "qty", width: 12, numFmt: QTY_FMT },
    { header: "Kg", key: "weightKg", width: 12, numFmt: QTY_FMT },
    { header: "Kartela", key: "swatchCount", width: 9, numFmt: INT_FMT },
    { header: "Sevkiyat", key: "shipmentNo", width: 18 },
    ...(withNotes ? [{ header: "Çuval Notu", key: "notes", width: 40 }] : []),
  ];

  const rows = dumps.map((d) => ({
    sackNo: d.sackNo,
    customer: d.customerName ?? "Müşterisiz (genel stok)",
    branch: d.branchName ?? "",
    branchCode: d.branchCode ?? "",
    rollCount: d.rolls.length,
    qty: dumpTotalQty(d),
    // Tartılmamış çuvalda 0 YAZMA — "0 kg" ile "tartılmadı" farklı bilgi.
    weightKg: d.weightKg ?? "",
    swatchCount: d.swatches.length,
    shipmentNo: d.shipmentNo ?? "",
    ...(withNotes ? { notes: d.notes ?? "" } : {}),
  }));

  const totalRow = {
    sackNo: `TOPLAM (${dumps.length} çuval)`,
    rollCount: dumps.reduce((a, d) => a + d.rolls.length, 0),
    qty: dumps.reduce((a, d) => a + dumpTotalQty(d), 0),
    weightKg: dumps.reduce((a, d) => a + (d.weightKg ?? 0), 0),
    swatchCount: dumps.reduce((a, d) => a + d.swatches.length, 0),
  };

  return { name: "Özet", columns, rows, totalRow };
}

/** Tek çuvalın top sayfası. */
function sackSheet(d: SackDump, name: string, mode: SackDumpNameMode): SheetSpec {
  return {
    name,
    columns: [
      { header: "Barkod", key: "barcode", width: 20 },
      // ⭐ ÜÇ AD (2026-09-07): dökümü çıktı alan kişi bizim adımızı, müşterinin
      //    adını ve ETİKETTE YAZANI yan yana görsün. Müşteri karşılığı yoksa
      //    hücre BOŞ kalır — bizim adımızı oraya kopyalamak "müşteri bunu böyle
      //    çağırıyor" yalanını üretirdi.
      // ⭐ AD REJİMİ (2026-09-10): `bizdeki` müşteri sütunlarını hiç çizmez,
      //    `musterideki` bizimkileri çizmez; `ikisi` (varsayılan) bugünkü kümedir.
      //    Sütunu GİZLEMEK ile BOŞ BIRAKMAK farklı sözler: gizlenen sütun "bu
      //    kâğıtta o dil yok" der, boş hücre "karşılığı yok" der.
      ...(mode === "musterideki" ? [] : [{ header: "Kumaş", key: "item", width: 26 }]),
      ...(mode === "bizdeki" ? [] : [{ header: "Müşteri kumaş", key: "musteriItem", width: 26 }]),
      ...(mode === "musterideki" ? [] : [{ header: "Renk", key: "color", width: 18 }]),
      ...(mode === "bizdeki" ? [] : [{ header: "Müşteri renk", key: "musteriColor", width: 18 }]),
      { header: "Etikette", key: "etiket", width: 26 },
      { header: "En (cm)", key: "width", width: 10, numFmt: QTY_FMT },
      { header: "Metre", key: "qty", width: 12, numFmt: QTY_FMT },
      { header: "Kalite", key: "quality", width: 12 },
    ],
    rows: d.rolls.map((r) => ({
      barcode: r.barcode ?? "Açık Kumaş",
      item: r.itemName,
      musteriItem: r.musteriItemName ?? "",
      color: r.colorName ?? "Ham",
      musteriColor: r.musteriColorName ?? "",
      // "basılmamış" ile "basıldı ama adı kayıtlı değil" AYRI durumlardır.
      etiket: !r.etiketBasildi
        ? "basılmamış"
        : `${r.etiketBayat ? "BAYAT — " : ""}${r.etiketAd ?? "(ad kayıtlı değil)"}`,
      width: r.width ?? "",
      qty: r.qty,
      quality: r.qualityGrade ?? "",
    })),
    // Boş çuvalda TOPLAM satırı basmayalım — tek başına "0" yanıltıcı olur.
    ...(d.rolls.length > 0
      ? {
          totalRow: {
            barcode: `TOPLAM (${d.rolls.length} top)`,
            qty: dumpTotalQty(d),
          },
        }
      : {}),
  };
}

/** Tüm çuvalların kartelaları — tek sayfa (yalnız kartela varsa üretilir). */
function swatchSheet(dumps: SackDump[]): SheetSpec | null {
  const rows = dumps.flatMap((d) =>
    d.swatches.map((s) => ({
      sackNo: d.sackNo,
      barcode: s.barcode ?? "Kartela",
      item: s.itemName,
      color: s.colorName ?? "Ham",
    })),
  );
  if (rows.length === 0) return null;
  return {
    name: "Kartelalar",
    columns: [
      { header: "Çuval No", key: "sackNo", width: 18 },
      { header: "Barkod", key: "barcode", width: 20 },
      { header: "Kumaş", key: "item", width: 26 },
      { header: "Renk", key: "color", width: 18 },
    ],
    rows,
    totalRow: { sackNo: `TOPLAM (${rows.length} kartela)` },
  };
}

/** Döküm → çalışma kitabı sayfaları (Özet + çuval başına sayfa + kartelalar). */
export function buildSackDumpSheets(dumps: SackDump[], opts: SackDumpOptions = {}): SheetSpec[] {
  const withNotes = !!opts.withNotes;
  const used = new Set<string>(["Özet", "Kartelalar"]); // ayrılmış adlar
  const sheets: SheetSpec[] = [summarySheet(dumps, withNotes)];
  const mode: SackDumpNameMode = opts.nameMode ?? "ikisi";
  for (const d of dumps) sheets.push(sackSheet(d, uniqueSheetName(d.sackNo, used), mode));
  const sw = swatchSheet(dumps);
  if (sw) sheets.push(sw);
  return sheets;
}
