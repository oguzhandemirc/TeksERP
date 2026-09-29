// =============================================================================
// PATRON BULUTU — PROJEKSİYON KATALOĞU TASLAĞI (B1 tasarımı, ölçüm girdisi)
// =============================================================================
// NE: `docs/design/PATRON-BULUTU-ESITLEME.md` §3'ün makinece okunur hâli. Üç ölçüm
// betiği (`patron-sema-olcumu` · `patron-hacim-olcumu` · `patron-yazim-noktalari`)
// bu tabloyu ŞEMAYA ve KODA karşı ölçer; belge sayıları buradan basar.
//
// ⚠️ TASLAKTIR, KAYNAK DEĞİLDİR: B1 uygulama dilimi kataloğu
// `src/cloud-sync/projections.ts`e taşır ve o gün tek kaynak kod olur (belge ona
// uyar). O dilime kadar bu dosya ile belge §3 birlikte değişir.
//
// SÖZLÜK: `tel` = eşitleme paketindeki alan adı (Türkçe, sözleşmedir — fabrika
// kolonu yeniden adlandırılsa da değişmez); `kaynak` = fabrikadaki DB kolonu.
// Kolon listesi OPT-IN'dir: burada yazmayan kolon buluta GİTMEZ (blocklist değil).
// =============================================================================

/** Veri sınıfı — KVKK eki (B7) bu etiketlerden kategori listesi üretir. */
export type VeriSinifi = "ISLEM" | "FINANS" | "KISISEL";

export interface Kolon {
  tel: string;
  kaynak: string;
  sinif?: VeriSinifi; // yoksa ISLEM
}

/** Fabrikada hesaplanıp projeksiyona giren alan — bulut bunu HESAPLAMAZ, yalnız saklar. */
export interface Turetilmis {
  tel: string;
  /** Fabrikadaki TEK KAYNAK yardımcı (dosya + ad). `YOK:` ile başlıyorsa bugün yardımcı yok, çıkarılacak. */
  yardimci: string;
  /** Zamanla (hiçbir satır değişmeden) değişir mi — öyleyse gün dönümünde yeniden gönderilir. */
  zamanaBagli?: boolean;
  sinif?: VeriSinifi;
}

/** Kök satırı kirleten tablo: bu tablodaki değişiklik hangi kök kimliğini yeniden hesaplatır. */
export interface Bagimlilik {
  tablo: string;
  /**
   * Değişiklik tespit kolonu — `updatedAt` (değişebilir satır) · `createdAt` (ekleme-yalnız) ·
   * `isaret` (tabloda güvenilir filigran YOK; DB tetikleyicisi `sync_marks` tablosuna KIRLI yazar — tasarım §4.4).
   */
  filigran: "updatedAt" | "createdAt" | "isaret";
  /** Değişen satırdan kök kimliğine yol (SQL ifadesi değil, okunur tarif). `self` = kök tablonun kendisi. */
  kokeYol: string;
}

export type SilmeStratejisi =
  /** Uygulamada hard delete yolu ÖLÇÜLMEDİ (yalnız soft delete). Tetikleyici yine kurulur (§4.4: statik tarama kördür). */
  | "YOK"
  /** Ölçülmüş hard delete yolu VAR; AFTER DELETE tetikleyicisi `sync_marks` tablosuna SILINDI yazar (tasarım §4.4). */
  | "DAMGA"
  /** Kapsamdan çıkış (ör. taslak fatura buluta hiç girmez) — silinse de bulutta satırı yoktur. */
  | "KAPSAM_DISI";

export interface KayitProjeksiyonu {
  ad: string;
  tur: "KAYIT";
  /** BOYUT = başka projeksiyonların id ile işaret ettiği ad/kod sözlüğü; OLGU = iş kaydı. */
  rol: "BOYUT" | "OLGU";
  kok: { tablo: string; model: string };
  /** Kök satırın buluta girme koşulu (okunur); yoksa hepsi. */
  kapsam?: string;
  kolonlar: Kolon[];
  turetilmis: Turetilmis[];
  bagimliliklar: Bagimlilik[];
  silme: SilmeStratejisi;
  /**
   * Bulut OKUMA izni (tasarım §10). `bulut:oturum` = tesisin her hesabı (BOYUT sözlükleri).
   * FINANS/KISISEL sınıflı kolonlar kök izinle GELMEZ: ayrı alt satıra (`<ad>.finans` /
   * `<ad>.kisisel`) bölünür ve kendi izniyle açılır (tasarım §9.3 — RLS projeksiyon süzmesi).
   */
  izin: string;
  /** Fabrika modül anahtarı kapalıysa projeksiyon gönderilmez. */
  modul?: string;
}

export interface AnlikProjeksiyon {
  ad: string;
  tur: "ANLIK";
  /** Fabrikadaki TEK KAYNAK hesap (dosya + fonksiyon). */
  kaynak: string;
  /** HER_TUR (eşitleme aralığı) · SAATLIK · GUNLUK — ayrıca konu zili `ozet`le anında. */
  siklik: "HER_TUR" | "SAATLIK" | "GUNLUK";
  izin: string;
  modul?: string;
  /** Okuduğu tablolar — hacim ve maliyet ölçümü için. */
  okudugu: string[];
}

export type Projeksiyon = KayitProjeksiyonu | AnlikProjeksiyon;

const k = (tel: string, kaynak: string, sinif?: VeriSinifi): Kolon => ({ tel, kaynak, ...(sinif ? { sinif } : {}) });
const self = (tablo: string): Bagimlilik => ({ tablo, filigran: "updatedAt", kokeYol: "self" });

// ── BOYUT projeksiyonları ─────────────────────────────────────────────────────
// Olgu satırları bu sözlüklere yalnız id ile işaret eder; bulut ADI görüntü için
// birleştirir (aritmetik değil). Ürün yeniden adlandırılınca bir satır gider,
// on bin sipariş kalemi değil.
const BOYUTLAR: KayitProjeksiyonu[] = [
  {
    ad: "urun", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "items", model: "Item" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("tur", "itemType"), k("birim", "unit"),
      k("yasamDurumu", "lifecycleStatus"), k("aktif", "isActive"), k("birlestigiKayit", "mergedIntoId")],
    turetilmis: [], bagimliliklar: [self("items")], silme: "DAMGA", izin: "bulut:oturum",
  },
  {
    ad: "renk", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "colors", model: "Color" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("hex", "hex"), k("aktif", "isActive"),
      k("birlestigiKayit", "mergedIntoId")],
    turetilmis: [], bagimliliklar: [self("colors")], silme: "YOK", izin: "bulut:oturum",
  },
  {
    ad: "depo", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "warehouses", model: "Warehouse" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("varsayilan", "isDefault"), k("aktif", "isActive")],
    turetilmis: [], bagimliliklar: [self("warehouses")], silme: "DAMGA", izin: "bulut:oturum",
  },
  {
    ad: "istasyon", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "stations", model: "Station" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("tur", "type"), k("aktif", "isActive")],
    turetilmis: [], bagimliliklar: [self("stations")], silme: "DAMGA", izin: "bulut:oturum",
  },
  {
    ad: "cari-kart", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "customers", model: "Customer" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("tur", "type"),
      k("musteriRolu", "isCustomerRole"), k("tedarikciRolu", "isSupplierRole"), k("fasonRolu", "isSubcontractorRole"),
      k("il", "city"), k("ilce", "district"), k("ulke", "country"), k("varsayilanYon", "defaultDestination"),
      k("yetkili", "contactName", "KISISEL"), k("telefon", "contactPhone", "KISISEL"),
      k("aktif", "isActive"), k("birlestigiKayit", "mergedIntoId"), k("olusturulma", "createdAt")],
    turetilmis: [], bagimliliklar: [self("customers")], silme: "DAMGA", izin: "bulut:oturum",
  },
  {
    ad: "sube", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "customer_branches", model: "CustomerBranch" },
    kolonlar: [k("id", "id"), k("cariKartId", "customerId"), k("kod", "code"), k("ad", "name"), k("il", "city"),
      k("ilce", "district"), k("varsayilanYon", "defaultDestination"), k("aktif", "isActive")],
    turetilmis: [], bagimliliklar: [self("customer_branches")], silme: "YOK", izin: "bulut:oturum",
  },
  {
    ad: "fason-firma", tur: "KAYIT", rol: "BOYUT", kok: { tablo: "subcontractors", model: "Subcontractor" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("cariKartId", "customerId"), k("aktif", "isActive"),
      k("birlestigiKayit", "mergedIntoId")],
    turetilmis: [], bagimliliklar: [self("subcontractors")], silme: "YOK", izin: "bulut:oturum",
  },
];

// ── OLGU projeksiyonları ──────────────────────────────────────────────────────
const OLGULAR: KayitProjeksiyonu[] = [
  {
    ad: "siparis", tur: "KAYIT", rol: "OLGU", kok: { tablo: "orders", model: "Order" },
    kolonlar: [k("id", "id"), k("siparisNo", "orderNumber"), k("cariKartId", "customerId"), k("subeId", "branchId"),
      k("yon", "destination"), k("doviz", "currency"), k("tutar", "totalAmount", "FINANS"), k("durum", "status"),
      k("siparisTarihi", "orderDate"), k("termin", "deadline"), k("sevkMiktari", "shippedQty"),
      k("tamamlanma", "completedAt"), k("iptalTarihi", "cancelledAt"), k("iptalSebepKodu", "cancelReasonCode"),
      k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "acikMiktar", yardimci: "helpers/order-line-scope.helper.ts isActiveLine+isMeasuredLine (Σ quantity − shippedQty)" },
      { tel: "kalemSayisi", yardimci: "helpers/order-line-scope.helper.ts isActiveLine" },
      { tel: "gecikmis", yardimci: "YOK: open-order-coverage 'overdue' tanımı (termin < fabrika günü ∧ açık) yardımcıya çıkarılacak", zamanaBagli: true },
    ],
    bagimliliklar: [self("orders"), { tablo: "order_lines", filigran: "updatedAt", kokeYol: "order_lines.orderId" }],
    silme: "YOK", izin: "bulut:siparis:oku",
  },
  {
    ad: "siparis-kalemi", tur: "KAYIT", rol: "OLGU", kok: { tablo: "order_lines", model: "OrderLine" },
    kolonlar: [k("id", "id"), k("siparisId", "orderId"), k("urunId", "itemId"), k("renkId", "colorId"),
      k("miktar", "quantity"), k("birim", "unit"), k("birimFiyat", "unitPrice", "FINANS"), k("en", "width"),
      k("sevkMiktari", "shippedQty"), k("parcaBoyu", "pieceLengthM"), k("musteriUrunAdi", "customerItemName"),
      k("musteriRenkAdi", "customerColorName"), k("iptalTarihi", "cancelledAt"), k("iptalSebepKodu", "cancelReasonCode"),
      k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "acikMiktar", yardimci: "helpers/order-line-scope.helper.ts isActiveLine+isMeasuredLine (ölçülmeyen birimde null)" },
    ],
    bagimliliklar: [self("order_lines")],
    silme: "DAMGA", izin: "bulut:siparis:oku",
  },
  {
    ad: "sevkiyat", tur: "KAYIT", rol: "OLGU", kok: { tablo: "shipments", model: "Shipment" },
    kolonlar: [k("id", "id"), k("sevkNo", "shipmentNo"), k("durum", "status"), k("cariKartId", "customerId"),
      k("subeId", "branchId"), k("yon", "destination"), k("cikisTarihi", "dispatchedAt"), k("disFaturaNo", "invoiceNo"),
      k("faturalanma", "invoicedAt"), k("iptalTarihi", "cancelledAt"), k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "toplamMetre", yardimci: "YOK: shipping.service listShipments.attachTotals (BRÜT: canlı Σ + iade geri-eklemesi, tek RR anlık görüntü) yardımcıya çıkarılacak" },
      { tel: "toplamKg", yardimci: "YOK: aynı attachTotals" },
      { tel: "cuvalSayisi", yardimci: "listShipments _count.sacks" },
      { tel: "topSayisi", yardimci: "listShipments _count.rolls" },
      { tel: "siparisIdleri", yardimci: "shipment_orders isActive=true" },
    ],
    bagimliliklar: [self("shipments"),
      { tablo: "sacks", filigran: "updatedAt", kokeYol: "sacks.shipmentId (ESKİ sevkiyat ayrılmada görünmez → FK tetikleyicisi, §4.3)" },
      { tablo: "rolls", filigran: "updatedAt", kokeYol: "rolls.shipmentId (ESKİ sevkiyat ayrılmada görünmez → FK tetikleyicisi, §4.3)" },
      { tablo: "roll_returns", filigran: "updatedAt", kokeYol: "roll_returns.fromShipmentId" },
      { tablo: "shipment_orders", filigran: "isaret", kokeYol: "shipment_orders.shipmentId (updatedAt/id YOK, küme deleteMany+create ile yenilenir — §4.3)" }],
    silme: "YOK", izin: "bulut:sevkiyat:oku",
  },
  {
    ad: "dogrudan-sevk", tur: "KAYIT", rol: "OLGU", kok: { tablo: "direct_shipments", model: "DirectShipment" },
    kolonlar: [k("id", "id"), k("sevkNo", "shipmentNo"), k("cariKartId", "customerId"), k("subeId", "branchId"),
      k("toplamMetre", "totalQty"), k("topSayisi", "rollCount"), k("cikisTarihi", "shippedAt"),
      k("disFaturaNo", "invoiceNo"), k("faturalanma", "invoicedAt"), k("olusturulma", "createdAt")],
    turetilmis: [],
    bagimliliklar: [self("direct_shipments")],
    silme: "YOK", izin: "bulut:sevkiyat:oku",
  },
  {
    ad: "cuval", tur: "KAYIT", rol: "OLGU", kok: { tablo: "sacks", model: "Sack" },
    kolonlar: [k("id", "id"), k("cuvalNo", "sackNo"), k("sevkiyatId", "shipmentId"), k("cariKartId", "customerId"),
      k("subeId", "branchId"), k("depoId", "warehouseId"), k("partiId", "packingGroupId"), k("ambalajNo", "packageNo"),
      k("kg", "weightKg"), k("tartilma", "weighedAt"), k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "topSayisi", yardimci: "YOK: listSackStoreBoard/attachTotals içindeki roll.groupBy(sackId) yardımcıya çıkarılacak" },
      { tel: "metre", yardimci: "YOK: aynı (Σ rolls.currentQty, sackId)" },
    ],
    bagimliliklar: [self("sacks"), { tablo: "rolls", filigran: "updatedAt", kokeYol: "rolls.sackId (ESKİ çuval ayrılmada görünmez → FK tetikleyicisi, §4.3)" }],
    silme: "DAMGA", izin: "bulut:sevkiyat:oku",
  },
  {
    ad: "is-emri", tur: "KAYIT", rol: "OLGU", kok: { tablo: "work_orders", model: "WorkOrder" },
    kolonlar: [k("id", "id"), k("isEmriNo", "workOrderNumber"), k("tur", "type"), k("durum", "status"),
      k("urunId", "targetItemId"), k("renkId", "targetColorId"), k("hedefMiktar", "targetQuantity"), k("en", "width"),
      k("planBaslangic", "plannedStartDate"), k("planBitis", "plannedEndDate"), k("aktif", "isActive"),
      k("iptalTarihi", "cancelledAt"), k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "uretilenMetre", yardimci: "workorder.service.ts withProductionMeters (private → dışa açılacak)" },
      { tel: "girenMetre", yardimci: "workorder.service.ts withProductionMeters → computeWoInput" },
      { tel: "siparisMetre", yardimci: "workorder.service.ts withProductionMeters" },
      { tel: "cariKartIdleri", yardimci: "helpers/work-order-customers.helper.ts rollupWorkOrderCustomers" },
      { tel: "aktifIstasyonId", yardimci: "YOK: adım durumundan (work_order_steps IN_PROGRESS/PENDING ilk) — liste detayındaki tanım yardımcıya çıkarılacak" },
    ],
    bagimliliklar: [self("work_orders"),
      { tablo: "work_order_steps", filigran: "updatedAt", kokeYol: "work_order_steps.workOrderId" },
      { tablo: "rolls", filigran: "updatedAt", kokeYol: "rolls.producedInStepId|currentStepId → work_order_steps.workOrderId (ESKİ adım ayrılmada görünmez → FK tetikleyicisi, §4.3)" },
      { tablo: "work_order_to_order_lines", filigran: "updatedAt", kokeYol: "work_order_to_order_lines.workOrderId" }],
    silme: "YOK", izin: "bulut:uretim:oku", modul: "production.enabled",
  },
  {
    ad: "cari-hesap", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cari_accounts", model: "CariAccount" },
    kolonlar: [k("id", "id"), k("tur", "kind"), k("cariKartId", "customerId"), k("fasonFirmaId", "subcontractorId"),
      k("varsayilanDoviz", "defaultCurrency"), k("vadeGun", "paymentTermDays", "FINANS"), k("riskLimiti", "riskLimit", "FINANS"),
      k("aktif", "isActive")],
    turetilmis: [
      { tel: "bakiyeler", yardimci: "cari.service.ts list (cari_balances, sıfır olmayan, para birimi bazında)", sinif: "FINANS" },
      { tel: "gecikmis", yardimci: "reports/finance-aging.report.ts collectAgingRows (asOf=şimdi) — cari listesinin withOverdue'su ile AYNI çekirdek", zamanaBagli: true, sinif: "FINANS" },
    ],
    bagimliliklar: [self("cari_accounts"),
      { tablo: "cari_balances", filigran: "updatedAt", kokeYol: "cari_balances.cariId" },
      { tablo: "invoices", filigran: "updatedAt", kokeYol: "invoices.cariId" },
      { tablo: "payments", filigran: "updatedAt", kokeYol: "payments.cariId" },
      { tablo: "cheques", filigran: "updatedAt", kokeYol: "cheques.cariId" }],
    silme: "YOK", izin: "bulut:cari-bakiye:oku", modul: "finance.enabled",
  },
  {
    ad: "cari-hareket", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cari_transactions", model: "CariTransaction" },
    kolonlar: [k("id", "id"), k("cariHesapId", "cariId"), k("doviz", "currency"), k("tarih", "txnDate"),
      k("borc", "debit", "FINANS"), k("alacak", "credit", "FINANS"), k("tutarTl", "amountTry", "FINANS"),
      k("kur", "exchangeRate", "FINANS"), k("kaynak", "sourceType"), k("faturaId", "invoiceId"), k("tahsilatOdemeId", "paymentId"),
      k("cekId", "chequeId"), k("tersKayitId", "reversesTxnId"), k("aciklama", "description"), k("olusturulma", "createdAt")],
    turetilmis: [],
    bagimliliklar: [{ tablo: "cari_transactions", filigran: "createdAt", kokeYol: "self" }],
    silme: "YOK", izin: "bulut:cari-bakiye:oku", modul: "finance.enabled",
  },
  {
    ad: "kasa", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cash_boxes", model: "CashBox" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("doviz", "currency"), k("bakiye", "balance", "FINANS"),
      k("aktif", "isActive")],
    turetilmis: [], bagimliliklar: [self("cash_boxes")], silme: "YOK", izin: "bulut:kasa:oku", modul: "finance.enabled",
  },
  {
    ad: "banka", tur: "KAYIT", rol: "OLGU", kok: { tablo: "bank_accounts", model: "BankAccount" },
    kolonlar: [k("id", "id"), k("kod", "code"), k("ad", "name"), k("banka", "bankName"), k("doviz", "currency"),
      k("bakiye", "balance", "FINANS"), k("aktif", "isActive")],
    turetilmis: [], bagimliliklar: [self("bank_accounts")], silme: "YOK", izin: "bulut:kasa:oku", modul: "finance.enabled",
  },
  {
    ad: "kasa-hareketi", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cash_transactions", model: "CashTransaction" },
    kolonlar: [k("id", "id"), k("belgeNo", "docNo"), k("tur", "kind"), k("yon", "direction"), k("durum", "status"),
      k("kasaId", "cashBoxId"), k("bankaId", "bankAccountId"), k("doviz", "currency"), k("tutar", "amount", "FINANS"),
      k("tutarTl", "amountTry", "FINANS"), k("tarih", "txnDate"), k("kategori", "category"), k("aciklama", "description"),
      k("transferGrubu", "transferGroupId"), k("tahsilatOdemeId", "paymentId"), k("iptalTarihi", "cancelledAt"),
      k("olusturulma", "createdAt")],
    turetilmis: [], bagimliliklar: [self("cash_transactions")], silme: "YOK", izin: "bulut:kasa:oku", modul: "finance.enabled",
  },
  {
    ad: "cek-senet", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cheques", model: "Cheque" },
    kolonlar: [k("id", "id"), k("belgeNo", "docNo"), k("tur", "kind"), k("belgeTuru", "docType"), k("durum", "status"),
      k("cariHesapId", "cariId"), k("cirolananCariHesapId", "endorsedToCariId"), k("bankaId", "bankAccountId"),
      k("doviz", "currency"), k("tutar", "amount", "FINANS"), k("tutarTl", "amountTry", "FINANS"),
      k("eslesen", "allocatedTotal", "FINANS"), k("duzenleme", "issueDate"), k("vade", "dueDate"), k("kayitTarihi", "postingDate"),
      k("seriNo", "serialNo"), k("banka", "bankName"), k("kesideci", "drawerName", "KISISEL"), k("iptalTarihi", "cancelledAt"),
      k("olusturulma", "createdAt")],
    turetilmis: [], bagimliliklar: [self("cheques")], silme: "YOK", izin: "bulut:cek:oku", modul: "finance.enabled",
  },
  {
    ad: "cek-hareketi", tur: "KAYIT", rol: "OLGU", kok: { tablo: "cheque_events", model: "ChequeEvent" },
    kolonlar: [k("id", "id"), k("cekId", "chequeId"), k("tur", "type"), k("onceki", "fromStatus"), k("sonraki", "toStatus"),
      k("tarih", "eventDate"), k("karsiCariHesapId", "counterCariId"), k("olusturulma", "createdAt")],
    turetilmis: [], bagimliliklar: [{ tablo: "cheque_events", filigran: "createdAt", kokeYol: "self" }],
    silme: "YOK", izin: "bulut:cek:oku", modul: "finance.enabled",
  },
  {
    ad: "fatura", tur: "KAYIT", rol: "OLGU", kok: { tablo: "invoices", model: "Invoice" },
    kapsam: "status <> 'DRAFT' (taslak buluta GİRMEZ; taslağın silinmesi kapsam dışı)",
    kolonlar: [k("id", "id"), k("belgeNo", "docNo"), k("tur", "type"), k("durum", "status"), k("cariHesapId", "cariId"),
      k("doviz", "currency"), k("kur", "exchangeRate", "FINANS"), k("tarih", "issueDate"), k("vade", "dueDate"),
      k("disNo", "externalNo"), k("araToplam", "subtotal", "FINANS"), k("iskonto", "discountTotal", "FINANS"),
      k("kdv", "vatTotal", "FINANS"), k("tevkifat", "withholdingTotal", "FINANS"), k("genelToplam", "grandTotal", "FINANS"),
      k("genelToplamTl", "grandTotalTry", "FINANS"), k("odenen", "paidTotal", "FINANS"), k("sevkiyatId", "shipmentId"),
      k("dogrudanSevkId", "directShipmentId"), k("onay", "confirmedAt"), k("iptalTarihi", "cancelledAt"),
      k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "acikTutar", yardimci: "reports/finance-aging.report.ts collectAgingRows açık tutar tanımı (grandTotal − paidTotal) yardımcıya çıkarılacak", sinif: "FINANS" },
      { tel: "vadesiGecti", yardimci: "reports/finance-aging.report.ts efektif vade (belge vadesi → tarih + cari vade günü)", zamanaBagli: true },
    ],
    bagimliliklar: [self("invoices")],
    silme: "KAPSAM_DISI", izin: "bulut:fatura:oku", modul: "finance.enabled",
  },
  {
    ad: "fatura-kalemi", tur: "KAYIT", rol: "OLGU", kok: { tablo: "invoice_lines", model: "InvoiceLine" },
    kapsam: "üst fatura status <> 'DRAFT' (onaydan sonra kalem değişmez — ölç)",
    kolonlar: [k("id", "id"), k("faturaId", "invoiceId"), k("sira", "lineNo"), k("urunId", "itemId"),
      k("aciklama", "description"), k("miktar", "qty"), k("birim", "unit"), k("birimFiyat", "unitPrice", "FINANS"),
      k("iskontoOrani", "discountRate", "FINANS"), k("kdvOrani", "vatRate", "FINANS"),
      k("tevkifatOrani", "withholdingRate", "FINANS"), k("tutar", "lineTotal", "FINANS"), k("kdvTutari", "vatAmount", "FINANS")],
    turetilmis: [],
    bagimliliklar: [{ tablo: "invoices", filigran: "updatedAt", kokeYol: "invoice_lines.invoiceId (kalem üst faturayla birlikte gider)" }],
    silme: "KAPSAM_DISI", izin: "bulut:fatura:oku", modul: "finance.enabled",
  },
  {
    ad: "tahsilat-odeme", tur: "KAYIT", rol: "OLGU", kok: { tablo: "payments", model: "Payment" },
    kolonlar: [k("id", "id"), k("belgeNo", "docNo"), k("yon", "direction"), k("yontem", "method"), k("durum", "status"),
      k("cariHesapId", "cariId"), k("doviz", "currency"), k("tutar", "amount", "FINANS"), k("tutarTl", "amountTry", "FINANS"),
      k("eslesen", "allocatedTotal", "FINANS"), k("kasaId", "cashBoxId"), k("bankaId", "bankAccountId"),
      k("tarih", "paymentDate"), k("referans", "reference"), k("iptalTarihi", "cancelledAt"), k("olusturulma", "createdAt")],
    turetilmis: [
      { tel: "eslesmemis", yardimci: "YOK: amount − allocatedTotal (payment-allocation.service sayaç sözleşmesi) yardımcıya çıkarılacak", sinif: "FINANS" },
    ],
    bagimliliklar: [self("payments")],
    silme: "YOK", izin: "bulut:tahsilat:oku", modul: "finance.enabled",
  },
  {
    ad: "fiyat", tur: "KAYIT", rol: "OLGU", kok: { tablo: "item_prices", model: "ItemPrice" },
    kolonlar: [k("id", "id"), k("urunId", "itemId"), k("cariKartId", "customerId"), k("tur", "kind"), k("doviz", "currency"),
      k("fiyat", "price", "FINANS"), k("degisim", "updatedAt")],
    turetilmis: [],
    bagimliliklar: [self("item_prices")],
    silme: "DAMGA", izin: "bulut:fiyat:oku", modul: "finance.enabled",
  },
];

// ── ANLIK (toplam) projeksiyonlar ─────────────────────────────────────────────
// Her turda bütünüyle yeniden hesaplanır; içerik özeti (sha256) bir önceki
// gönderilenle aynıysa GÖNDERİLMEZ. Artımlı değildir — kök satırı yoktur.
const ANLIKLAR: AnlikProjeksiyon[] = [
  { ad: "ozet", tur: "ANLIK", kaynak: "services/boss/overview.service.ts getBossOverview (izin süzmesiz çekirdek; bölüm başına alt kayıt ve bulut izni — tasarım §3.3)",
    siklik: "HER_TUR", izin: "bulut:ozet:oku",
    okudugu: ["rolls", "order_lines", "orders", "sacks", "shipments", "work_order_steps", "subcontractor_dispatches", "subcontractor_dispatch_items"] },
  { ad: "ozet-finans", tur: "ANLIK", kaynak: "YENİ bölüm: kasa/banka bakiyeleri (stored) + ChequeService.summary/dueSummary + collectAgingRows toplamı",
    siklik: "HER_TUR", izin: "bulut:cari-bakiye:oku", modul: "finance.enabled",
    okudugu: ["cash_boxes", "bank_accounts", "cheques", "invoices", "payments", "payment_allocations", "cari_accounts"] },
  { ad: "stok-karnesi", tur: "ANLIK", kaynak: "reports/stock-scorecard.report.service.ts getStockScorecard",
    siklik: "SAATLIK", izin: "bulut:stok:oku", okudugu: ["rolls", "order_lines", "orders", "items", "colors"] },
  { ad: "acik-siparis-karsilama", tur: "ANLIK", kaynak: "reports/open-order-coverage.report.service.ts getOpenOrderCoverage",
    siklik: "SAATLIK", izin: "bulut:siparis:oku", okudugu: ["order_lines", "orders", "rolls"] },
  { ad: "rapor-katalogu", tur: "ANLIK", kaynak: "constants/report-catalog.ts (audit/* ailesi HARİÇ; anahtar, başlık, parametre şeması, aile)",
    siklik: "GUNLUK", izin: "bulut:oturum", okudugu: [] },
  { ad: "uretim-akisi", tur: "ANLIK", kaynak: "inventory.service.ts getProductionFlow({includeQueues,includeSevk}) + DashboardService.getStationsLiveState",
    siklik: "HER_TUR", izin: "bulut:uretim:oku", modul: "production.enabled", okudugu: ["rolls", "work_order_steps", "stations", "sacks", "shipments"] },
];

/**
 * Projeksiyon DEĞİL, değişiklik tespitinin kendisi için okunan tablolar.
 * Birleştirme FK'ları ham UPDATE ile taşır ve `updatedAt`e dokunmaz; taşınan
 * satırların kimliği `merge_operation_refs.rowIds`te durur (tasarım §4.5).
 */
export const YARDIMCI_OKUMALAR: ReadonlyArray<{ tablo: string; filigran: string; neden: string }> = [
  { tablo: "merge_operations", filigran: "createdAt", neden: "yeni birleştirme → refs'teki satırlar kirli" },
  { tablo: "merge_operations", filigran: "revertedAt", neden: "geri alınan birleştirme → aynı satırlar yeniden kirli" },
  { tablo: "merge_operation_refs", filigran: "createdAt", neden: "MOVED satır kimlikleri (tableName, rowIds)" },
  { tablo: "sync_marks", filigran: "createdAt", neden: "YENİ (tasarım §4.4) — tetikleyicilerin yazdığı SILINDI/KIRLI işaretleri; bugün yok" },
];

export const PROJEKSIYONLAR: readonly Projeksiyon[] = [...BOYUTLAR, ...OLGULAR, ...ANLIKLAR];
export const KAYIT_PROJEKSIYONLARI: readonly KayitProjeksiyonu[] = [...BOYUTLAR, ...OLGULAR];

/**
 * Bilinçli olarak buluta GİTMEYEN tablolar — "neden yok" sorusu tek yerde.
 * Değer: gerekçe. `patron-sema-olcumu` bu listeyi ve kataloğu şemanın TAMAMINA
 * karşı ölçer: ne katalogda ne burada olan tablo "sınıflanmamış" basılır.
 */
export const BILINCLI_DISARIDA: Readonly<Record<string, string>> = {
  system_logs: "audit ayak izidir, buluta gitmez (kök kural: audit yalnız yerel insan yüzeyi)",
  system_log_archives: "audit arşivi — aynı gerekçe",
  sessions: "kimlik akışı / telemetri",
  users: "fabrika kullanıcıları buluta gitmez (bulut hesapları bağımsız — B-Tur 2)",
  user_permissions: "fabrika yetkisi", permissions: "fabrika yetkisi",
  permission_templates: "fabrika yetkisi", permission_template_items: "fabrika yetkisi",
  totp_enrollments: "kimlik sırrı", user_recovery_codes: "kimlik sırrı", user_preferences: "kullanıcı tercihi",
  system_settings: "yapılandırma (şifre özetleri, kurulum kimliği taşır)",
  endpoint_latency_daily: "telemetri",
  rolls: "top düzeyi buluta gitmez (v1) — stok karnesi + sevkiyat/çuval toplamları yeter; top araması fabrikada",
  roll_status_events: "stok hareket defteri v1 dışı (hacim) — rapor isteğiyle", warehouse_movements: "aynı",
  roll_movements: "aynı", roll_operations: "üretim ayrıntısı", work_order_events: "iş emri hareket defteri v1 dışı",
  printed_documents: "belge içeriği", label_templates: "şablon", traveler_card_templates: "şablon",
  // v2 adayları — v1'de ANLIK özet bölümleriyle (fason/üretim) ya da rapor isteğiyle karşılanır:
  batches: "v2 adayı (parti izleme raporu isteğe bağlı)", packing_groups: "v2 adayı (sevk partisi)",
  purchase_orders: "v2 adayı (alış siparişi)", purchase_order_lines: "v2 adayı (alış siparişi)",
  goods_receipts: "v2 adayı (mal kabul)", sack_allocations: "sevk karşılama pivotu — sipariş sevkMiktari türetilmiş olarak gider",
  subcontractor_dispatches: "fason — v1'de özet 'fason' bölümü", subcontractor_dispatch_items: "fason — aynı",
  subcontractor_receipts: "fason — aynı", subcontractor_receipt_items: "fason — aynı",
  exchange_rates: "kur tablosu — finans satırları tutarTl'yi kendi kolonunda taşır",
  weaving_orders: "dokuma — v2 adayı", machine_runs: "tezgah defteri — randıman raporu isteğe bağlı",
  machine_stop_events: "tezgah defteri — duruş pareto raporu isteğe bağlı",
  warp_beams: "levent — v2 adayı", yarn_lots: "iplik — v2 adayı", yarn_stocks: "iplik — v2 adayı", yarn_movements: "iplik — v2 adayı",
  shipment_events: "sevkiyat olay defteri — v1'de durum/cikisTarihi yeter",
};
