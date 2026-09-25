// Muhasebe veri seti → exceljs SheetSpec eşlemesi. Sayılar gerçek number +
// numFmt (Excel'de sağa yaslı/biçimli); tarihler gerçek Date (tarih hücresi).
// Türkçe başlıklar. Fiyat YOK (miktar-odaklı).
import type { SheetSpec } from "@/lib/xlsx-export";
import type { AccountingExportData, DispatchReport } from "./types";

const NUM1 = "#,##0.0"; // metre/kg (1 ondalık)
const INT = "#,##0"; // adet
const DATE = "dd.mm.yyyy hh:mm";

/** null = yön kaydı yok (fasondan doğrudan sevk) — yurtiçi sayılmaz. */
const yon = (d: "DOMESTIC" | "EXPORT" | null) => (d === "EXPORT" ? "Yurtdışı" : d === "DOMESTIC" ? "Yurtiçi" : "Yön kaydı yok (doğrudan sevk)");
const toDate = (s: string | null) => (s ? new Date(s) : null);

/** Dosya adı: Sevk_Edilenler_<from>_<to>.xlsx (yalnız tarih kısmı). */
export function accountingExportFileName(range: AccountingExportData["range"]): string {
  const d = (s: string | null) => (s ? s.slice(0, 10) : "");
  return ["Sevk_Edilenler", d(range.from), d(range.to)].filter(Boolean).join("_");
}

/** Dönem dökümü → 5 sayfa (Sevk Listesi / Detay / İcmal·Müşteri / İcmal·Kumaş / İade). */
export function buildAccountingWorkbookSheets(data: AccountingExportData): SheetSpec[] {
  const t = data.totals;
  return [
    {
      name: "Sevk Listesi",
      columns: [
        { header: "Sevk No", key: "shipmentNo", width: 18 },
        { header: "Sevk Tarihi", key: "dispatchedAt", width: 18, numFmt: DATE },
        { header: "Müşteri Kodu", key: "customerCode", width: 14 },
        { header: "Müşteri", key: "docCustomerName", width: 28 },
        { header: "Vergi No", key: "taxNumber", width: 14 },
        { header: "Şube", key: "branchName", width: 18 },
        { header: "İhracat Kodu", key: "branchCode", width: 14 },
        { header: "Yön", key: "yon", width: 10 },
        { header: "Gümrük/İhracat No", key: "procedureCode", width: 18 },
        { header: "Plaka", key: "plateNumber", width: 12 },
        { header: "Sürücü", key: "driverName", width: 16 },
        { header: "Taşıyıcı", key: "carrier", width: 16 },
        // İKİ ÇUVAL RAKAMI yan yana: "Çuval (sistem)" kayıt adedi, "Çuval (fiili)"
        // operatörün araca yüklediğini beyan ettiği adet. Sahada 10 çuval tek
        // kayda yazıldığı için ikisi meşru olarak farklıdır; muhasebe hangisini
        // kullanacağına kendi karar verir. Beyan yoksa fiili sütunu BOŞ kalır
        // (0 yazmak "sıfır çuval gitti" gibi okunurdu).
        { header: "Çuval (sistem)", key: "sackCount", width: 13, numFmt: INT },
        { header: "Çuval (fiili)", key: "manualSackCountOrBlank", width: 12, numFmt: INT },
        { header: "Top", key: "rollCount", width: 9, numFmt: INT },
        { header: "Toplam Metre", key: "totalMeters", width: 14, numFmt: NUM1 },
        { header: "Toplam Kg", key: "totalKg", width: 12, numFmt: NUM1 },
        // Fatura izi — "hangi sevkin faturası kesilmedi" dönem kapanışında burada okunur.
        { header: "Fatura No", key: "invoiceNo", width: 18 },
        { header: "Fatura Tarihi", key: "invoicedAt", width: 14, numFmt: DATE },
        // Sevk notu muhasebeye de gider: "bu sevkte ne oldu" sorusunun cevabı
        // eskiden yalnız irsaliyede duruyordu.
        { header: "Sevk Notu", key: "dispatchNote", width: 40 },
      ],
      rows: data.shipments.map((s) => ({
        ...s,
        dispatchedAt: toDate(s.dispatchedAt),
        invoicedAt: toDate(s.invoicedAt),
        yon: yon(s.destination),
        // Beyan yoksa hücre BOŞ kalır — 0 yazmak "sıfır çuval gitti" diye okunur.
        manualSackCountOrBlank: s.manualSackCount > 0 ? s.manualSackCount : null,
      })),
      totalRow: {
        customerName: "TOPLAM",
        sackCount: t.sackCount,
        rollCount: t.rollCount,
        totalMeters: t.totalMeters,
        totalKg: t.totalKg,
      },
      // Brüt/net ayrımını dosyanın içine yaz: bu iki satır olmadan muhasebeci
      // "sevk − iade" yaptığında iadeyi ikinci kez düşme riski taşır.
      notes: [
        "* Rakamlar SEVK ANINDAKİ (brüt) değerlerdir — iade DÜŞÜLMEMİŞTİR. Net = Sevk − İade (bkz. \"İade\" sayfası).",
        "* \"İade\" sayfası DÖNEM İÇİNDE İADE ALINAN topları listeler; bunlar bu dönemde sevk edilmiş olmayabilir.",
      ],
    },
    {
      name: "Detay",
      columns: [
        { header: "Sevk No", key: "shipmentNo", width: 18 },
        { header: "Sevk Tarihi", key: "dispatchedAt", width: 18, numFmt: DATE },
        { header: "Müşteri", key: "docCustomerName", width: 28 },
        { header: "Sipariş No", key: "orderNos", width: 20 },
        { header: "Kumaş", key: "itemName", width: 24 },
        { header: "Renk", key: "colorName", width: 18 },
        { header: "En (cm)", key: "width", width: 10, numFmt: NUM1 },
        { header: "Top Adedi", key: "rollCount", width: 10, numFmt: INT },
        { header: "Metre", key: "meters", width: 12, numFmt: NUM1 },
      ],
      rows: data.detail.map((r) => ({ ...r, dispatchedAt: toDate(r.dispatchedAt) })),
    },
    {
      name: "İcmal · Müşteri",
      columns: [
        { header: "Müşteri Kodu", key: "customerCode", width: 14 },
        { header: "Müşteri", key: "docCustomerName", width: 28 },
        { header: "Vergi No", key: "taxNumber", width: 14 },
        { header: "Sevk Adedi", key: "shipmentCount", width: 11, numFmt: INT },
        { header: "Çuval", key: "sackCount", width: 9, numFmt: INT },
        { header: "Top", key: "rollCount", width: 9, numFmt: INT },
        { header: "Toplam Metre", key: "totalMeters", width: 14, numFmt: NUM1 },
        { header: "Toplam Kg", key: "totalKg", width: 12, numFmt: NUM1 },
      ],
      rows: data.byCustomer,
      totalRow: {
        customerName: "TOPLAM",
        shipmentCount: t.shipmentCount,
        sackCount: t.sackCount,
        rollCount: t.rollCount,
        totalMeters: t.totalMeters,
        totalKg: t.totalKg,
      },
    },
    {
      name: "İcmal · Kumaş",
      columns: [
        { header: "Kumaş", key: "itemName", width: 24 },
        { header: "Renk", key: "colorName", width: 18 },
        { header: "En (cm)", key: "width", width: 10, numFmt: NUM1 },
        { header: "Top Adedi", key: "rollCount", width: 10, numFmt: INT },
        { header: "Toplam Metre", key: "totalMeters", width: 14, numFmt: NUM1 },
      ],
      rows: data.byProduct,
      totalRow: { itemName: "TOPLAM", rollCount: t.rollCount, totalMeters: t.totalMeters },
    },
    {
      name: "İade",
      columns: [
        { header: "İade Tarihi", key: "returnedAt", width: 18, numFmt: DATE },
        { header: "Müşteri", key: "docCustomerName", width: 28 },
        { header: "Geldiği Sevk No", key: "fromShipmentNo", width: 18 },
        { header: "Barkod", key: "barcode", width: 18 },
        { header: "Kumaş", key: "itemName", width: 24 },
        { header: "Renk", key: "colorName", width: 18 },
        { header: "En (cm)", key: "width", width: 10, numFmt: NUM1 },
        { header: "Metre", key: "meters", width: 12, numFmt: NUM1 },
        { header: "Neden", key: "reason", width: 22 },
      ],
      rows: data.returns.map((r) => ({ ...r, returnedAt: toDate(r.returnedAt) })),
      totalRow: { customerName: "TOPLAM", meters: t.returnMeters },
    },
  ];
}

/**
 * Fiş dipnotları — rakamın NASIL okunacağını Excel'in içine yazar.
 *
 * Fiş sevk anındaki BRÜT değerleri gösterir (donmuş belgeden); sonradan alınan
 * iade DÜŞÜLMEZ. Dosya elden ele dolaştığında bu bağlam kaybolmasın diye not
 * rakamla aynı sayfada durur — "501 mi 452 mi" sorusunun cevabı burada.
 */
export function dispatchReportNotes(report: DispatchReport): string[] {
  const notes: string[] = [];
  // Alanlar HTTP'den gelir: eski bir yanıt ya da yeni bir üretici (fasondan doğrudan
  // sevk fişi gibi) bunları taşımayabilir. Not BASILMAMASI kabul edilebilir, muhasebe
  // export'unun ÇÖKMESİ değil → iddia edemediğimiz yerde susarız.
  if (report.returns == null || report.frozen == null) return notes;
  if (report.frozen) {
    notes.push(
      "* Bu fiş sevkiyatın SEVK ANINDAKİ (brüt) değerlerini gösterir — sevk irsaliyesiyle birebir aynıdır.",
    );
  } else {
    notes.push("* TASLAK — sevkiyat henüz sevk edilmedi; rakamlar sevke kadar değişebilir.");
  }
  if (report.docStatus === "VOIDED") {
    notes.push("* DİKKAT: Bu sevkiyatın irsaliyesi İPTAL edilmiştir.");
  }
  if (report.returns.count > 0) {
    notes.push(
      `* Bu sevkiyattan sonra ${report.returns.count} top / ` +
        `${report.returns.meters.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m ` +
        `iade alınmıştır. İade yukarıdaki rakamlardan DÜŞÜLMEMİŞTİR.`,
    );
    notes.push(
      "  İade dökümü: sevkiyat detayındaki \"İadeler\" bölümü ve muhasebe dönem dökümünün \"İade\" sayfası.",
    );
  }
  return notes;
}

/** Müşteri adı yoksa bizimkine düş — irsaliyedeki fail-open kuralının aynısı. */
const customerNameOr = (cust: string | null | undefined, ours: string): string =>
  (cust ?? "").trim() || ours;

/**
 * Ad rejimi yoksa (eski sunucu) BUGÜNKÜ davranış: yalnız bizim adımız.
 * Yeni bayrağın varsayılanı = bugünkü davranış kuralının birebir uygulaması.
 */
const DEFAULT_NAME_MODE = {
  showOurName: true,
  showCustomerName: false,
  cekiShowOurName: true,
  cekiShowCustomerName: false,
  productColorSplit: false,
} as const;

/**
 * Tek sevk fişi → 3 sayfa (Kumaş / Çuval / Çeki) — Fiş dialog'undan Excel.
 *
 * ⚠️ AD REJİMİNİ UYGULAR (2026-09-10). Eskiden uygulamıyordu ve sahada aynı
 * sevkiyatın PDF'i `BS-6650 EKRU` (müşterinin adı), Excel'i `LİNEN EKRU` (bizim
 * adımız) basıyordu — ikisi de AYNI donmuş belgeden. Ayarın kendi açıklaması
 * "kapsam sevk irsaliyesi + MUHASEBE FİŞİDİR" diyor; vaat yerine gelmiyordu.
 *
 * ⚠️ KARAR SUNUCUDA: hangi kolonun çizileceğini `report.docNameMode` söyler, burada
 * yeniden hesaplanmaz. `productColorSplit` de irsaliyeyle AYNI uygulanır: muhasebe
 * fişten fatura keser, faturadaki ad irsaliyedekiyle HÜCRE HÜCRE aynı olmalı —
 * ayrık kipte irsaliye "BS-6650 330cm." + boş renk basarken fişin "BS-6650 EKRU
 * 330cm." basması (bizim rengimiz yapışık) aynı saha şikâyetinin ikinci yüzüydü.
 */
export function buildDispatchReportSheets(report: DispatchReport): SheetSpec[] {
  const t = report.totals;
  const r = report.docNameMode ?? DEFAULT_NAME_MODE;
  const colorSplit = r.showCustomerName && r.productColorSplit;
  return [
    {
      name: "Kumaş Listesi",
      columns: [
        ...(r.showOurName ? [{ header: "Stok Adı", key: "name", width: 40 }] : []),
        ...(colorSplit
          ? [
              { header: "Müşterideki Stok Adı", key: "docCustomerName", width: 40 },
              { header: "Müşterideki Varyant", key: "docCustomerColor", width: 18 },
            ]
          : r.showCustomerName
            ? [{ header: "Müşterideki Stok Adı", key: "docCustomerName", width: 40 }]
            : []),
        { header: "Top", key: "rollCount", width: 9, numFmt: INT },
        { header: "Toplam Metre", key: "totalMeters", width: 14, numFmt: NUM1 },
      ],
      // Kolon çizilmiyorsa satıra anahtar da EKLENMEZ — okuyucusu olmayan bir
      // alan, "bu veri de gidiyor mu" sorusunu boş yere açar.
      // Ayrık kipte renk hücresi FALLBACK'SİZ (irsaliyeyle aynı): karşılığı
      // olmayan renkte bizim adımızı "Müşterideki Varyant" altında basmak yanlış
      // etiketlemedir; hücre boş kalır.
      rows: colorSplit
        ? report.products.map((p) => ({
            ...p,
            docCustomerName: customerNameOr(p.customerItemOnly ?? p.customerName, p.name),
            docCustomerColor: p.customerColorOnly ?? "",
          }))
        : r.showCustomerName
          ? report.products.map((p) => ({ ...p, docCustomerName: customerNameOr(p.customerName, p.name) }))
          : report.products,
      // "TOPLAM" hangi ad kolonu ÖNDEYSE oraya yazılır — yalnız müşteri adı
      // çizildiğinde `name` boş kalır ve toplam satırı etiketsiz görünürdü.
      totalRow: {
        ...(r.showOurName ? { name: "TOPLAM" } : { docCustomerName: "TOPLAM" }),
        rollCount: t.totalRolls,
        totalMeters: t.totalMeters,
      },
      notes: dispatchReportNotes(report),
    },
    {
      name: "Çuval Listesi",
      columns: [
        { header: "Çuval", key: "code", width: 14 },
        { header: "Toplam Metre", key: "totalMeters", width: 14, numFmt: NUM1 },
        { header: "Brüt Kg", key: "totalKg", width: 12, numFmt: NUM1 },
        { header: "Paket", key: "packageCount", width: 9, numFmt: INT },
      ],
      rows: report.sacks,
      totalRow: { code: "TOPLAM", totalMeters: t.totalMeters, totalKg: t.totalKg },
    },
    {
      name: "Çeki Listesi",
      columns: [
        { header: "Çuval", key: "sackCode", width: 12 },
        { header: "Barkod", key: "barcode", width: 18 },
        ...(r.cekiShowOurName
          ? [
              { header: "Desen", key: "desen", width: 24 },
              { header: "Varyant", key: "varyant", width: 18 },
            ]
          : []),
        ...(r.cekiShowCustomerName
          ? [
              { header: "Müşterideki Desen", key: "docCustomerDesen", width: 24 },
              { header: "Müşterideki Varyant", key: "docCustomerVaryant", width: 18 },
            ]
          : []),
        { header: "Metre", key: "meters", width: 12, numFmt: NUM1 },
        { header: "Kg", key: "kg", width: 10, numFmt: NUM1 },
      ],
      rows: r.cekiShowCustomerName
        ? report.cekiRows.map((c) => ({
            ...c,
            docCustomerDesen: customerNameOr(c.customerDesen, c.desen),
            docCustomerVaryant: customerNameOr(c.customerVaryant, c.varyant),
          }))
        : report.cekiRows,
    },
  ];
}
