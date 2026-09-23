// =============================================================================
// Belge Şablonu önizlemesi — örnek (mock) belge payload'ları (TEK KAYNAK)
// =============================================================================
// "Tanımlar → Belge Şablonları" panelinde admin içerik ayarını (bölüm aç/kapa,
// başlık, künye, imza, footer) düzenlerken sağda CANLI önizleme görür. Önizleme
// artık client React sheet'i değil, GERÇEK backend renderer'ının (renderHtml)
// bu örnek veriyle + taslak config override ile ürettiği HTML → önizleme baskıyla
// birebir aynı. Her payload ilgili renderHtml'in beklediği `doc` şeklindedir.
// =============================================================================

import { PrintedDocType } from "@prisma/client";

import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";

const ISO = "2026-06-07T10:30:00.000Z";

/**
 * Örnek belge numarası — SERİDEN TÜRETİLİR, literal YAZILMAZ (D7).
 *
 * ⚠️ ÇAĞRILAR GETTER İÇİNDE, DÜZ DEĞER DEĞİL (2026-09-23): bu dosya modül
 * düzeyinde bir sabit; düz değer yazıldığında `ornekNo` MODÜL YÜKLENİRKEN koşuyor
 * ve iki zarar veriyordu — ① numara serisi önbelleği o anda BOŞ olduğu için örnek
 * KATALOG TOHUMUYLA donuyor, yani fabrikanın gerçek ön ekini hiç göstermiyor
 * (türetmenin amacı tam da buydu) ② boş önbellek modül yüklenirken 52 seriyi
 * tazelemek için arka planda ~55 SELECT açıyor ve sorgu bütçesi ölçümüne taşıyor
 * (d3 ölçtü: pencere 64 → 72-95). Getter, aynı ifadeyi İSTEK ANINA erteler.
 *
 * ⚠️ Bu dosyanın sözleşmesi "önizleme baskıyla BİREBİR AYNI". Sabit bir
 * `MK1308260001` yazmak, fabrika mal kabul serisinin ön ekini değiştirdiği gün
 * önizlemeyi sessizce YALAN yapardı — üstelik kullanıcının "belge · çıktı ·
 * program aynı numarayı göstermeli" değişmezinin tam karşısında.
 *
 * ⚠️ KENDİ ÜRETECİ OLAN seride kullanılamaz: `previewSeriesCode` katalog
 * `infix`ini (top barkodunun faz harfi) YAZMAZ — o serinin örneği kendi
 * üretecinden gelmelidir, yoksa türetme sessiz bir yanlış üretir.
 */
function ornekNo(key: string, seq: number): string {
  return previewSeriesCode(resolveSeriesFormat(key), seq);
}

/** docType → renderHtml'in okuduğu örnek `doc`. Gerçek sevk verisi DEĞİL. */
export const SAMPLE_PRINTED_DOCS: Record<PrintedDocType, Record<string, unknown>> = {
  // Sevk İrsaliyesi / muhasebe fişi (renderShipmentDispatchHtml).
  SHIPMENT_DISPATCH: {
    header: {
      shipmentNo: "SVK-2026-0042",
      customerName: "Örnek Tekstil A.Ş.",
      customerCode: "M001",
      customerTaxNumber: "1234567890",
      branchName: "Merkez Şube",
      branchCode: "IST-01",
      customerExportCode: "EXP-TR-042",
      procedureCode: null,
      destination: "DOMESTIC",
      status: "DISPATCHED",
      date: ISO,
      plateNumber: "34 ABC 123",
      driverName: "Mehmet Yılmaz",
      carrier: "Hızlı Nakliyat",
      orderNos: "SIP-2026-0107",
    },
    products: [
      // `customerName` = müşterideki ad (2026-09-04). İkinci satırda BİLEREK YOK:
      // "Müşteri adıyla bas" rejimini seçen kişi, karşılığı olmayan üründe
      // BİZİM adımızın basıldığını (fail-open) önizlemede görmeli.
      { name: "Pamuklu Astar · Bej", customerName: "AKTOS · SAND", rollCount: 3, totalMeters: 480 },
      { name: "Süet Kumaş · Antrasit", customerName: null, rollCount: 2, totalMeters: 200 },
    ],
    sacks: [
      { code: "Ç-01", seq: 1, totalMeters: 480, totalKg: 42.5, packageCount: 3 },
      { code: "Ç-02", seq: 2, totalMeters: 200, totalKg: 31, packageCount: 2 },
    ],
    cekiRows: [
      { sackCode: "Ç-01", barcode: "TR-260607-R0200", desen: "Pamuklu Astar", varyant: "Bej", customerDesen: "AKTOS", customerVaryant: "SAND", width: 150, meters: 480, kg: 42.5, batchNumber: "P1207261" },
      // Bilerek FARKLI parti: çuval karışık içerikli olabilir — kolonu açan kişi
      // partinin çuval değil TOP başına taşındığını önizlemede görsün.
      { sackCode: "Ç-02", barcode: "TR-260607-R0201", desen: "Süet Kumaş", varyant: "Antrasit", width: 140, meters: 200, kg: 31, batchNumber: "P1207262" },
    ],
    totals: { totalRolls: 5, totalMeters: 680, totalKg: 73.5, sackCount: 2 },
  },

  // Fason Sevk / KUMAŞ İRSALİYESİ (renderFasonCekiHtml) — toplar ham gider.
  SUBCONTRACTOR_DISPATCH: {
    dispatchNo: "FSN-2026-0231",
    dispatchedAt: ISO,
    driverName: "Ali Demir",
    plateNumber: "16 XYZ 789",
    notes: "Acele — bugün dönüş bekleniyor",
    // ⚠️ `width` ZORUNLU: belgedeki tek EN değerinin kaynağı iş emridir. Örnek
    // veride eksik kalırsa Belge Şablonları'nın canlı önizlemesi EN'i BOŞ gösterir
    // ama gerçek baskı dolu çıkar — "önizleme = gerçek baskı" sözleşmesi tam da
    // ayarı yapan kişinin gözü önünde bozulur.
    workOrder: { id: "wo1", get workOrderNumber() { return ornekNo("workOrder", 1); }, type: "STOCK_PRODUCTION", width: 150 },
    subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
    requestedColor: "Bej",
    targetProperties: ["Yanmazlık Apresi", "Su İtici"],
    // ⚠️ `commands` ZORUNLU: talimat kutusu ("BOYANACAK RENK" / "YAPILACAK
    // İŞLEMLER") YALNIZ bu alandan doğar. Örnek veride eksik kalırsa Belge
    // Şablonları'nın canlı önizlemesi kutuyu HİÇ göstermez ama gerçek baskı
    // gösterir — "önizleme = gerçek baskı" sözleşmesi tam da ayarı yapan kişinin
    // gözü önünde bozulur. `targetProperties` de KALIR — ama DİKKAT: `commands`
    // koşulsuz olduğu için renderer'ın `!cmd` guard'ı eski "İSTENEN ÖZELLİKLER"
    // dalını bu örnek üzerinden ULAŞILMAZ kılar (önizleme onu göstermez). Alan
    // burada payload ŞEKLİNİ eksiksiz tutmak için duruyor; eski dalın regresyon
    // ölçümü örnekten DEĞİL, bekçinin kendi fixture'ından yapılır
    // (`test_fason_ceki_html.ts` §14c-14).
    commands: { color: "Bej", works: [{ name: "Yanmazlık Apresi" }, { name: "Su İtici" }] },
    batchNumber: "P1207261",
    instruction: "Yıkama yapma, matlaştır",
    step: { stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0123", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: null, colorName: null, dispatchedQty: 240, dispatchedWeight: 38, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0124", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: null, colorName: null, dispatchedQty: 260, dispatchedWeight: 41, qualityGrade: "A", width: 150 },
    ],
    totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
  },

  // Fasondan Doğrudan Sevk İrsaliyesi (renderFasonDirectShipHtml).
  SUBCONTRACTOR_DIRECT_SHIP: {
    directShip: true,
    dispatchNo: "DSF-2026-0012",
    directShippedAt: ISO,
    directShipReason: "Müşteri acil talep — fabrikaya dönmeden sevk",
    directShippedBy: "Ayşe Kaya",
    dispatchedAt: ISO,
    driverName: "Ali Demir",
    plateNumber: "16 XYZ 789",
    notes: null,
    batchNumber: "P1207261",
    customer: { id: "cus1", name: "Örnek Tekstil A.Ş.", code: "M001", taxNumber: "1234567890", branchName: "Merkez Şube", branchCode: "IST-01", exportCode: "EXP-TR-042" },
    workOrder: { id: "wo1", get workOrderNumber() { return ornekNo("workOrder", 1); }, type: "ORDER_PRODUCTION" },
    subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
    step: { id: "st1", stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0123", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 240, dispatchedWeight: 38, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0124", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 260, dispatchedWeight: 41, qualityGrade: "A", width: 150 },
    ],
    allocations: [
      { orderNumber: "SIP-2026-0107", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorName: "Bej", qty: 500 },
    ],
    totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
  },

  // Kartela Çeki Listesi (renderKartelaCekiHtml).
  KARTELA_DISPATCH: {
    dispatchNo: "KRT-2026-0058",
    dispatchedAt: ISO,
    driverName: "Hasan Kaya",
    plateNumber: "06 KRT 060",
    notes: null,
    subcontractor: { id: "ks1", name: "Desen Kartela", code: "KF-01" },
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0200", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 6, dispatchedWeight: 1.2, qualityGrade: "A", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0201", itemCode: "KMS-014", itemName: "Süet Kumaş", colorCode: "ANT", colorName: "Antrasit", dispatchedQty: 6, dispatchedWeight: 1.1, qualityGrade: "B", width: 140 },
    ],
    totals: { rollCount: 2, totalQty: 12, totalWeight: 2.3 },
  },

  // Fason Kabul Makbuzu (renderFasonReceiptHtml) — boyahane dönüşü.
  SUBCONTRACTOR_RECEIPT: {
    receiptNo: "SR-2606-000045",
    manifestNo: "YB-8842",
    receivedAt: ISO,
    notes: "Renk tutmuş, apre uygulanmış",
    subcontractor: { name: "Yıldız Boyahane", code: "FB-03" },
    workOrder: { get workOrderNumber() { return ornekNo("workOrder", 1); } },
    stationName: "Boyahane (Fason)",
    appliedColor: "Bej",
    appliedProperties: ["Yanmazlık Apresi", "Su İtici"],
    // Örnek bilerek ÇOĞUL: ayarı yapan kişi kabulün birden fazla partiyi
    // kapsayabildiğini önizlemede görsün.
    batchNumbers: ["P1207261", "P1207262"],
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0301", itemName: "Pamuklu Astar", colorName: "Bej", width: 150 },
      { sequence: 2, barcode: "TR-260607-R0302", itemName: "Pamuklu Astar", colorName: "Bej", width: 150 },
    ],
    totals: { rollCount: 2 },
  },

  // Kalite Sertifikası (renderQualityCertificateHtml).
  QUALITY_CERTIFICATE: {
    header: { shipmentNo: "SVK-2026-0042", customerName: "Örnek Tekstil A.Ş.", customerCode: "M001", date: ISO, orderNos: "SIP-2026-0107" },
    grades: [
      { grade: "A", rollCount: 4, totalMeters: 620 },
      { grade: "B", rollCount: 1, totalMeters: 60 },
    ],
    rolls: [
      { sequence: 1, barcode: "TR-260607-R0200", itemName: "Pamuklu Astar", colorName: "Bej", width: 150, grade: "A", meters: 160 },
      { sequence: 2, barcode: "TR-260607-R0201", itemName: "Süet Kumaş", colorName: "Antrasit", width: 140, grade: "B", meters: 60 },
    ],
    totals: { rollCount: 5, totalMeters: 680 },
  },

  // İade İrsaliyesi (renderReturnDispatchHtml) — top-başına.
  RETURN_DISPATCH: {
    header: { documentNo: "IADE-070626-A1B2C3", customerName: "Örnek Tekstil A.Ş.", customerCode: "M001", date: ISO, fromShipmentNo: "SVK-2026-0042", orderNo: "SIP-2026-0107" },
    line: { barcode: "TR-260607-R0200", itemName: "Pamuklu Astar", colorName: "Bej", width: 150, qty: 160, grade: "A" },
    reason: "Renk uyumsuzluğu",
    note: "Müşteri partiyle uyumsuz olduğunu bildirdi",
    receivedBy: "Ayşe Kaya",
  },

  // Refakat kartı (2026-08-17) — bu ekranda ÖRNEĞİ YOK, bilerek boş.
  // Kartın kendi canlı önizlemesi ayrı bir uçtur (`/api/traveler-cards/sample-html`,
  // Refakat Kartı Şablonları ekranı) ve kendi config/şablon zincirini kullanır.
  // Buraya sahte bir kart koymak, iki ayrı örnek verinin zamanla ayrışması demekti.
  // Ulaşılamaz: generic sample-html yolu bu tipte 400 verir (SELF_MANAGED_DOC_TYPES).
  TRAVELER_CARD: {},
  // ── Ticaret paketi: iç depo belgeleri (2026-08-13) ────────────────────────
  // Örnek veri, Belge Şablonları ekranının CANLI ÖNİZLEMESİNİ besler — bu yüzden
  // belge tipiyle AYNI commit'te gelmek zorunda (örneksiz tip = boş/çöp kart).
  TRANSFER_DISPATCH: {
    header: {
      get documentNo() { return ornekNo("warehouseTransfer", 1); },
      date: ISO,
      fromWarehouseName: "Merkez Depo",
      fromWarehouseCode: "DP-MERKEZ",
      toWarehouseName: "Şube Deposu",
      get toWarehouseCode() { return ornekNo("warehouse", 2); },
      createdBy: "Mehmet Yılmaz",
    },
    lines: [
      { barcode: "T130826F0101", itemName: "Perde Kumaşı", colorName: "Ekru", width: 300, qty: 120 },
      { barcode: "T130826F0102", itemName: "Perde Kumaşı", colorName: "Ekru", width: 300, qty: 85.5 },
    ],
    notes: "Şube talebi üzerine sevk edildi",
  },
  GOODS_RECEIPT: {
    header: {
      get documentNo() { return ornekNo("goodsReceipt", 1); },
      date: ISO,
      warehouseName: "Merkez Depo",
      warehouseCode: "DP-MERKEZ",
      supplierName: "Örnek Tedarik A.Ş.",
      get supplierCode() { return ornekNo("customer", 7); },
      deliveryNoteNo: "IRS-2026-4471",
      createdBy: "Ayşe Kaya",
    },
    lines: [
      { barcode: "T130826F0201", itemName: "Perde Kumaşı", colorName: "Krem", width: 300, qty: 200 },
      { barcode: "T130826F0202", itemName: "Perde Kumaşı", colorName: "Krem", width: 300, qty: 180 },
      { barcode: "T130826F0203", itemName: "Tül", colorName: null, width: 280, qty: 150 },
    ],
    notes: null,
  },

  // Ön muhasebe çıktıları (2026-08-14). Sınır durumları BİLİNÇLİ olarak örnekte:
  // faturada dövizli + tevkifatlı bir kalem (TL karşılığı satırı ve tevkifat
  // satırı önizlemede görünsün), makbuzda ise TL (en sık hâl).
  INVOICE_INTERNAL: {
    header: {
      documentNo: "FTR1408260001",
      date: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 864e5).toISOString(),
      type: "SALES",
      typeLabel: "Satış Faturası",
      partyName: "Örnek Tekstil Ltd. Şti.",
      partyCode: "CR-000148",
      partyTaxInfo: "Merkez V.D. · 1234567890",
      currency: "USD",
      exchangeRate: "40.250000",
      externalNo: "IRS-2026-8812",
      createdBy: "Ayşe Kaya",
    },
    lines: [
      { description: "Patos Kumaş · Gri", qty: "520", unit: "m", unitPrice: "3.4500",
        discountRate: "0", vatRate: "20", lineNet: "1794.00", lineVat: "358.80" },
      { description: "Saten Kumaş · Ekru", qty: "180", unit: "m", unitPrice: "5.1000",
        discountRate: "5", vatRate: "20", lineNet: "872.10", lineVat: "174.42" },
      { description: "Nakliye bedeli", qty: "1", unit: "adet", unitPrice: "150.0000",
        discountRate: "0", vatRate: "20", lineNet: "150.00", lineVat: "30.00" },
    ],
    totals: { net: "2816.10", vat: "563.22", withholding: "112.64", grand: "3266.68", grandTry: "131483.87" },
    notes: null,
  },
  PAYMENT_RECEIPT: {
    header: {
      documentNo: "THS1408260001",
      date: new Date().toISOString(),
      direction: "IN",
      directionLabel: "Tahsilat Makbuzu",
      partyName: "Örnek Tekstil Ltd. Şti.",
      partyCode: "CR-000148",
      method: "BANK_TRANSFER",
      methodLabel: "Havale / EFT",
      accountName: "Ziraat Bankası — TL Vadesiz",
      currency: "TRY",
      exchangeRate: null,
      createdBy: "Ayşe Kaya",
    },
    amount: "50000.00",
    amountTry: null,
    notes: "Ağustos dönemi kısmi tahsilat.",
  },

  // Resmi ön muhasebe belgeleri (2026-08-15, J2 #18). Sınır durumları yine
  // BİLİNÇLİ olarak örnekte: mutabakatta ÜÇ para birimi (biri SIFIR bakiyeli —
  // "hareketi var ama kapanmış" satırı da mutabakatın konusudur) ve bordroda
  // İKİ para birimi (tek TOPLAM yazılmadığı dal önizlemede görünsün).
  RECONCILIATION_LETTER: {
    header: {
      get documentNo() { return ornekNo("reconciliationLetter", 1); },
      date: new Date().toISOString(),
      asOf: new Date().toISOString(),
      partyName: "Örnek Tekstil Ltd. Şti.",
      partyCode: "CR-000148",
      partyTaxInfo: "Merkez V.D. · 1234567890",
      createdBy: "Ayşe Kaya",
    },
    balances: [
      { currency: "TRY", debit: "184500.00", credit: "121000.00", balance: "63500.00" },
      { currency: "USD", debit: "12000.00", credit: "15400.00", balance: "-3400.00" },
      { currency: "EUR", debit: "5000.00", credit: "5000.00", balance: "0.00" },
    ],
    notes: null,
  },
  CHEQUE_DELIVERY_NOTE: {
    header: {
      get documentNo() { return ornekNo("chequeDeliveryNote", 1); },
      date: new Date().toISOString(),
      kind: "RECEIVED",
      kindLabel: "Alınan",
      targetName: "Ziraat Bankası — TL Vadesiz",
      targetKindLabel: "Teslim Edilen Banka",
      createdBy: "Ayşe Kaya",
    },
    lines: [
      {
        get docNo() { return ornekNo("chequeReceived", 1); }, serialNo: "0034512", issueDate: ISO,
        dueDate: new Date(Date.now() + 45 * 864e5).toISOString(),
        drawerName: "Yıldız Konfeksiyon A.Ş.", bankName: "Garanti BBVA",
        currency: "TRY", amount: "42500.00",
      },
      {
        get docNo() { return ornekNo("chequeReceived", 2); }, serialNo: "0034513", issueDate: ISO,
        dueDate: new Date(Date.now() + 60 * 864e5).toISOString(),
        drawerName: "Yıldız Konfeksiyon A.Ş.", bankName: "Garanti BBVA",
        currency: "TRY", amount: "18750.50",
      },
      {
        get docNo() { return ornekNo("noteReceived", 3); }, serialNo: null, issueDate: ISO,
        dueDate: new Date(Date.now() + 30 * 864e5).toISOString(),
        drawerName: "Delta Tekstil Ltd.", bankName: null,
        currency: "USD", amount: "5000.00",
      },
    ],
    totals: [
      { currency: "TRY", count: 2, amount: "61250.50" },
      { currency: "USD", count: 1, amount: "5000.00" },
    ],
    notes: "Tahsile verilmek üzere teslim edilmiştir.",
  },

  // Tam stok sayımı (2026-08-15, J2 #19). SINIR DURUMLARI BİLİNÇLİ OLARAK
  // ÖRNEKTE: dört top durumunun DÖRDÜ de (bulundu · eksik · sayılmadı · kapsam
  // dışı) ve iplikte hem uygulanan fark hem kapsam dışı satır var — şablonu
  // ayarlayan kişi "DURUM" kolonunun neye benzediğini önizlemede görmeli.
  STOCK_COUNT: {
    header: {
      get documentNo() { return ornekNo("stockCount", 1); },
      date: ISO,
      warehouseName: "Merkez Depo",
      warehouseCode: "DP-MERKEZ",
      createdBy: "Ayşe Kaya",
      completedBy: "Mehmet Yılmaz",
      status: "Tamamlandı",
      // Örnek TAMAMLANMIŞ tutanaktır (panel önizlemesi belgenin resmi hâlini
      // göstermeli) — bayrak açıkça yazılır ki "alan yoksa true" yedeğine
      // dayanmasın; o yedek yalnız 2026-08-15 öncesi snapshot'lar için var.
      finalized: true,
    },
    rollLines: [
      { barcode: "T150826F0301", itemName: "Perde Kumaşı", colorName: "Ekru", width: 300, expectedQty: 120, countedQty: 120, state: "FOUND", outOfScopeReason: null, notes: null },
      { barcode: "T150826F0302", itemName: "Perde Kumaşı", colorName: "Ekru", width: 300, expectedQty: 85.5, countedQty: null, state: "MISSING", outOfScopeReason: null, notes: "Rafta bulunamadı" },
      { barcode: "T150826F0303", itemName: "Tül", colorName: null, width: 280, expectedQty: 150, countedQty: null, state: "UNCOUNTED", outOfScopeReason: null, notes: null },
      { barcode: "T150826F0304", itemName: "Tül", colorName: null, width: 280, expectedQty: 60, countedQty: null, state: "OUT_OF_SCOPE", outOfScopeReason: "Bu sırada sevk edildi", notes: null },
    ],
    yarnLines: [
      { itemName: "Pamuk İplik Ne 30", expectedKg: 500, countedKg: 487.5, diffKg: -12.5, state: "APPLIED", outOfScopeReason: null },
      { itemName: "Polyester İplik 150D", expectedKg: 200, countedKg: 200, diffKg: 0, state: "MATCH", outOfScopeReason: null },
      { itemName: "Viskon İplik Ne 40", expectedKg: 75, countedKg: 80, diffKg: null, state: "OUT_OF_SCOPE", outOfScopeReason: "Bakiye sayımdan sonra değişti (defter 95 kg)" },
    ],
    summary: {
      rollTotal: 4, rollFound: 1, rollMissing: 1, rollUncounted: 1, rollOutOfScope: 1,
      expectedMeters: 415.5, missingMeters: 85.5,
      yarnTotal: 3, yarnApplied: 1, yarnUncounted: 0, yarnOutOfScope: 1, yarnDiffKg: -12.5,
    },
    notes: "Yıl sonu tam sayımı.",
  },
};
