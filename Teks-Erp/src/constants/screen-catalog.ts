// =============================================================================
// EKRAN MANİFESTOSU — hangi ekran hangi yetkiyi ister (2026-08-19)
// =============================================================================
// Yetki mimarisinin 2. katmanı. Karar belgesi: docs/design/YETKI-MIMARISI.md
//
// NEDEN VAR: bugüne kadar "KK1 ekranı hangi yetkileri kullanır" sorusunun
// cevabı YALNIZ route dosyaları taranarak bulunabiliyordu. Yönetici atama
// ekranında 68 kutuyla karşılaşıyor ve hangisinin hangi ekranı açtığını
// bilmiyor. SAP'ın `SU24` tablosunun karşılığı: ekran, ihtiyaç duyduğu
// yetkileri VERİ olarak beyan eder.
//
// ⚠️ EKRAN BAŞINA YETKİ TANIMLAMAZ — ekranlar var olan yetkileri TALEP EDER.
// `kk1:kumas-ekle` + `electron:kumas-ekle` gibi ikizler üretmek aynı iş
// yeteneğini iki kodda yaşatır, ayrışır ve "Ali kumaş ekleyebilir mi?"
// sorusunun tek cevabı kalmaz. Bu yüzden `mobile:kumas` gibi ORTAK yetkiler
// birden çok ekranda görünür — arayüz bunu SÖYLEMEK ZORUNDA, yoksa "KK1'den
// kaldırdım, Hızlı İş Emri bozuldu" sürprizi olur.
//
// ⚠️ TEK KAYNAK: iki istemciye de `GET /api/admin/screens` ile servis edilir.
// Mobil/Electron aynası AÇILMAZ (mevcut `permissions.ts` ayna derdinin tekrarı).
//
// BAKIM: liste ELLE yazılır ama `scripts/test_screen_catalog.ts` onu iki
// istemcinin GERÇEK beyanlarına karşı doğrular — yeni ekran eklenip buraya
// yazılmazsa test kırmızı verir. Yani liste bayatlayamaz.
// =============================================================================

import { PERMISSION_CATALOG } from "./permission-catalog";

export interface ScreenCapability {
  /** Yetki kodu — PERMISSION_CATALOG'da BULUNMAK ZORUNDA (bekçi doğrular). */
  code: string;
  /** Operatörün anlayacağı dille NE yapabildiği ("Yeni desen oluşturabilir"). */
  label: string;
}

export interface ScreenEntry {
  /** Mobilde ekran anahtarı (`KK1`), masaüstünde route yolu (`definitions/items`). */
  key: string;
  app: "mobile" | "desktop";
  title: string;
  /** Ekranı AÇMAK için gereken izinler — HERHANGİ BİRİ yeterlidir. */
  requires: string[];
  /** Ekran İÇİNDE ek yetenek açan izinler. */
  capabilities: ScreenCapability[];
}

/** Masaüstü ekranlarında yetenekler kod taramasından türetildi → etiket üretilir. */
const CAP_LABEL: Record<string, string> = {
  "item:write": "Kumaş ekleyip düzenleyebilir",
  "customer:write": "Müşteri ekleyip düzenleyebilir",
  "customer-alias:write": "Müşteriye özel ad eşlemesi yazabilir",
  "station:write": "İstasyon/makine tanımı düzenleyebilir",
  "quality:write": "Kalite tanımı düzenleyebilir",
  "property:write": "Renk/özellik tanımı düzenleyebilir",
  "return:write": "İade kaydı açabilir",
  "subcontractor:write": "Fason firma düzenleyebilir",
  "label-template:read": "Etiket şablonlarını görebilir",
  "label-template:write": "Etiket şablonu düzenleyebilir",
  "order:write": "Sipariş açıp düzenleyebilir",
  "workorder:write": "İş emri açıp düzenleyebilir",
  "workorder:distribute": "Kurşun dağıtımı yapabilir",
  "roll:write": "Top kaydı düzenleyebilir",
  "roll:manual-adjust": "Top metraj/kalite düzeltmesi (riskli)",
  "roll:history": "Topun yaşam döngüsünü görebilir",
  "shipping:write": "Sevkiyat düzenleyebilir",
  "shipping:invoice": "Fatura işareti koyabilir (riskli)",
  "shipping:undo-dispatch": "Sevki geri alabilir (riskli)",
  "kartela:write": "Kartela işlemi yapabilir",
  "label:print": "Etiket basabilir",
  "label:read": "Etiket önizleyebilir",
  "label:edit": "Etiketteki müşteri adını düzeltebilir",
  "admin:settings": "Sistem ayarlarını değiştirebilir",
  "order:read": "Sipariş görebilir",
  "shipping:read": "Sevkiyat görebilir",
  "workorder:read": "İş emri görebilir",
  "customer-alias:read": "Müşteri ad eşlemesini görebilir",
  "property:read": "Renk/özellik görebilir",
  "quality:read": "Kalite tanımı görebilir",
  "station:read": "İstasyon görebilir",
  "report:sales": "Satış raporu görebilir",
  "document-template:write": "Belge tasarımını değiştirebilir",
  "settings:workstation": "Bu bilgisayarın donanım ayarlarını değiştirebilir",
  // Depo mal kabul + ön muhasebe (2026-09-01) — kutunun yanında NE yapabildiği
  // yazmazsa yönetici atama ekranında ham kodu okur.
  "goods-receipt:write": "Mal kabul fişi açıp düzenleyebilir",
  "warehouse:write": "Depo tanımı ve sayım düzenleyebilir",
  "yarn:write": "İplik stok hareketi girebilir",
  "price:write": "Kalem fiyatı tanımlayabilir",
  "finance:write": "Cari/kasa/banka kartı düzenleyebilir",
  "finance:invoice": "Fatura kesip iptal edebilir",
  "finance:payment": "Tahsilat/ödeme girebilir",
  "finance:cheque": "Çek/senet işleyebilir",
  "finance:close": "Dönem kapanışı yapabilir",
};

/** Etiketi olmayan kod için kodun kendisi basılır — sessiz boşluk bırakma. */
export const capLabel = (code: string): string => CAP_LABEL[code] ?? code;

const desktop: Array<Omit<ScreenEntry, "capabilities"> & { capabilities: string[] }> = [
  { key: "definitions/items", app: "desktop", title: "Kumaşlar", requires: ["item:read"], capabilities: ["item:write"] },
  { key: "definitions/customers", app: "desktop", title: "Müşteriler", requires: ["customer:read"], capabilities: ["customer-alias:write", "customer:write", "label-template:write"] },
  { key: "definitions/stations", app: "desktop", title: "Üretim İstasyonları", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/machines", app: "desktop", title: "Makineler", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/peripherals", app: "desktop", title: "Donanım", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/labels", app: "desktop", title: "Etiketler", requires: ["station:read"], capabilities: ["label-template:read", "label-template:write"] },
  { key: "definitions/routes", app: "desktop", title: "Üretim Rotaları", requires: ["station:read"], capabilities: ["property:write", "station:write"] },
  { key: "definitions/product-recipes", app: "desktop", title: "İş Emri Şablonları", requires: ["station:read"], capabilities: ["station:write"] },
  // TEK EKRAN, DÖRT SEKME (fire · kayıt düzeltmesi · elle ekleme · iptal) —
  // düzenleme `roll:manual-adjust` YETENEĞİdir, ekranı görmek için gerekmez.
  { key: "definitions/reason-presets", app: "desktop", title: "Hazır Sebepler", requires: ["roll:read"], capabilities: ["roll:manual-adjust"] },
  { key: "definitions/defect-types", app: "desktop", title: "Hata Tipleri", requires: ["quality:read"], capabilities: ["quality:write"] },
  { key: "definitions/quality-grades", app: "desktop", title: "Kalite Sınıfları", requires: ["quality:read"], capabilities: [] },
  { key: "definitions/colors", app: "desktop", title: "Renkler", requires: ["property:read"], capabilities: ["property:write"] },
  { key: "definitions/return-reasons", app: "desktop", title: "İade Nedenleri", requires: ["return:read"], capabilities: ["return:write"] },
  { key: "definitions/fabric-properties", app: "desktop", title: "Kumaş Özellikleri", requires: ["property:read"], capabilities: ["property:write"] },
  { key: "definitions/subcontractor-categories", app: "desktop", title: "Fason Kategorileri", requires: ["subcontractor:read"], capabilities: ["subcontractor:write"] },
  { key: "definitions/subcontractors", app: "desktop", title: "Fason Firmalar", requires: ["subcontractor:read"], capabilities: ["subcontractor:write"] },
  { key: "definitions/station-capabilities", app: "desktop", title: "İstasyon Yetenekleri", requires: ["station:read"], capabilities: [] },
  { key: "definitions/label-templates", app: "desktop", title: "Etiket Tasarımı", requires: ["label-template:read"], capabilities: ["label-template:write"] },
  { key: "access/devices", app: "desktop", title: "Tabletler", requires: ["admin:settings"], capabilities: [] },
  { key: "access", app: "desktop", title: "Yetkilendirme", requires: ["admin:users"], capabilities: [] },
  { key: "access/users", app: "desktop", title: "Kullanıcılar", requires: ["admin:users"], capabilities: [] },
  { key: "access/templates", app: "desktop", title: "Yetki Şablonları", requires: ["admin:users"], capabilities: [] },
  { key: "access/permissions", app: "desktop", title: "Yetki Kataloğu", requires: ["admin:users"], capabilities: [] },
  { key: "system", app: "desktop", title: "Sistem", requires: ["admin:settings"], capabilities: [] },
  { key: "system/activity", app: "desktop", title: "Aktivite Günlüğü", requires: ["admin:settings"], capabilities: [] },
  { key: "system/perf", app: "desktop", title: "Endpoint Performansı", requires: ["admin:settings"], capabilities: [] },
  { key: "system/server-status", app: "desktop", title: "Sunucu Durumu", requires: ["admin:settings"], capabilities: [] },
  { key: "system/work-sessions", app: "desktop", title: "Çalışma Oturumları", requires: ["admin:settings"], capabilities: [] },
  { key: "system/backups", app: "desktop", title: "Yedekler", requires: ["admin:settings"], capabilities: [] },
  // Veri Aktarımı — `admin:settings` DEĞİL: toplu yükleme sistem yönetimi değil
  // VERİ yönetimidir ve ayrı atanır. Ekranın kendisi `data:import` ile açılır;
  // hangi varlığa yazılabileceği ayrıca o varlığın write izniyle sınırlıdır
  // (uç guard'ı iki katmanlıdır — `import.routes.ts`).
  { key: "system/data-import", app: "desktop", title: "Veri Aktarımı", requires: ["data:import"], capabilities: [] },
  // Mükerrer Kayıtlar — `admin:settings` DEĞİL: "bu iki müşteri aynı firma mı?"
  // sorusunun cevabını ana veriyi TANIYAN kişi (satış/planlama) bilir, sistem
  // yöneticisi bilmez. `capabilities` dört varlığın write iznidir: ekran
  // açılır ama birleştirme ikinci kapıyı da arar (`master-data-merge.routes`).
  { key: "system/duplicates", app: "desktop", title: "Mükerrer Kayıtlar", requires: ["master-data:merge"], capabilities: ["customer:write", "item:write", "property:write", "subcontractor:write"] },
  { key: "system/db-restore", app: "desktop", title: "Veritabanı Geri Yükleme", requires: ["admin:settings"], capabilities: [] },
  { key: "system/logs", app: "desktop", title: "Sistem Kayıtları", requires: ["admin:settings"], capabilities: [] },
  { key: "system/archive", app: "desktop", title: "Aktivite Arşivi", requires: ["admin:settings"], capabilities: [] },
  { key: "system/roll-archive", app: "desktop", title: "Top Arşivi", requires: ["admin:settings"], capabilities: [] },
  { key: "operations/orders", app: "desktop", title: "Siparişler", requires: ["order:read"], capabilities: ["customer-alias:read", "order:write", "shipping:read", "workorder:write"] },
  { key: "operations/work-orders", app: "desktop", title: "İş Emirleri", requires: ["workorder:read"], capabilities: ["order:write", "property:write", "roll:manual-adjust", "workorder:write"] },
  { key: "operations/rolls", app: "desktop", title: "Envanter", requires: ["roll:read"], capabilities: ["kartela:write", "label:print", "label:read", "roll:history", "roll:manual-adjust", "roll:write"] },
  { key: "operations/kursun-dagitim", app: "desktop", title: "Kurşun Planlama", requires: ["quality:write", "workorder:distribute"], capabilities: [] },
  { key: "operations/product-balance", app: "desktop", title: "Kumaş Dengesi", requires: ["workorder:read"], capabilities: ["workorder:write"] },
  { key: "operations/shipments", app: "desktop", title: "Sevkiyatlar", requires: ["shipping:read"], capabilities: ["return:write", "shipping:invoice", "shipping:undo-dispatch", "shipping:write"] },
  { key: "operations/sack-store", app: "desktop", title: "Sevk Kapısı", requires: ["shipping:read"], capabilities: ["shipping:write"] },
  { key: "operations/sack-content-edit", app: "desktop", title: "Paketleme / Çuvallar", requires: ["shipping:write"], capabilities: ["label:print"] },
  { key: "operations/relabel-station", app: "desktop", title: "Yeniden Etiketle", requires: ["label:edit", "roll:write"], capabilities: [] },
  { key: "operations/accounting-dispatch", app: "desktop", title: "Sevkiyatlar (Muhasebe)", requires: ["report:sales", "shipping:read"], capabilities: ["shipping:invoice"] },
  { key: "operations/kartela", app: "desktop", title: "Kartela Takibi", requires: ["kartela:read"], capabilities: ["kartela:write"] },
  { key: "operations/returns", app: "desktop", title: "İade Takibi", requires: ["return:read"], capabilities: ["return:write"] },
  { key: "reports/production", app: "desktop", title: "Üretim", requires: ["report:production"], capabilities: [] },
  { key: "reports/sales", app: "desktop", title: "Sipariş & Sevkiyat", requires: ["report:sales"], capabilities: [] },
  { key: "reports/quality", app: "desktop", title: "Kalite", requires: ["report:quality"], capabilities: [] },
  { key: "reports/inventory", app: "desktop", title: "Stok & Depo", requires: ["report:inventory"], capabilities: [] },
  { key: "reports/subcontract", app: "desktop", title: "Fason", requires: ["report:subcontract"], capabilities: [] },
  { key: "reports/customer", app: "desktop", title: "Müşteri", requires: ["report:customer"], capabilities: [] },
  { key: "reports/audit", app: "desktop", title: "Denetim", requires: ["report:audit"], capabilities: [] },
  // ⚠️ AŞAĞIDAKİ BEŞİ ELLE EKLENDİ — route tarayıcısı bunları GÖREMEZ:
  // dördü `requireAnyPermission={DOCUMENT_DESIGN_READ}` gibi SABİT REFERANSLA
  // korunuyor (satır içi dizi değil), beşincisi ise route değil Genel Ayarlar
  // İÇİNDEKİ bir sekme. Bekçi bu iki biçimi de çözer; yeni bir sabit-referanslı
  // route eklenirse test kırmızı verir.
  { key: "definitions/document-templates", app: "desktop", title: "Belge Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card", app: "desktop", title: "Refakat Kartı", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card-studio", app: "desktop", title: "Refakat Kartı Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/free-documents", app: "desktop", title: "Serbest Belgeler", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "settings", app: "desktop", title: "Genel Ayarlar", requires: ["admin:settings", "settings:workstation"], capabilities: ["settings:workstation"] },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPO MAL KABUL + ÖN MUHASEBE (2026-09-01, birleştirme onarımı)
  // ═══════════════════════════════════════════════════════════════════════════
  // Bu iki modül `feature/depo-mal-kabul` dalında, manifesto ise `adnansahin`
  // dalında doğdu — birleşene kadar hiç yan yana gelmediler. Sonuç: 18 ekran ve
  // 16 izin manifestoda HİÇ görünmüyordu. Etkisi yalnız bekçi kırmızısı değil:
  // manifesto `GET /api/admin/screens` ile Yetki Kataloğu ekranına servis
  // ediliyor ve yönetici "bu kutu hangi ekranı açar" sorusunun cevabını orada
  // arıyor. Beyansız izin o ekranda GEREKÇESİZ bir kutu olarak duruyordu.
  //
  // ⚠️ Finans ekranlarının HEPSİ `finance:read` ile açılır — yazma yetkileri
  // (`finance:invoice`, `finance:payment`, `finance:cheque`, `finance:close`)
  // sayfa İÇİNDE `PermissionGate` ile ayrılır, route'a konmaz. Bu yüzden onlar
  // `requires` değil `capabilities`tir; kart listesiyle (Finance/tile-config)
  // birebir aynı olması gereken şey `requires` tarafıdır.
  { key: "finance", app: "desktop", title: "Ön Muhasebe", requires: ["finance:read"], capabilities: [] },
  { key: "finance/cari", app: "desktop", title: "Cari Hesaplar", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/invoices", app: "desktop", title: "Faturalar", requires: ["finance:read"], capabilities: ["finance:invoice"] },
  { key: "finance/payments", app: "desktop", title: "Tahsilat ve Ödemeler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/accounts", app: "desktop", title: "Kasa ve Banka Hesapları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cash-transactions", app: "desktop", title: "Kasa Hareketleri", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/rates", app: "desktop", title: "Döviz Kurları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cheques", app: "desktop", title: "Çek ve Senetler", requires: ["finance:read"], capabilities: ["finance:cheque"] },
  { key: "finance/allocations", app: "desktop", title: "Tahsisler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/period-close", app: "desktop", title: "Dönem Kapanışı", requires: ["finance:read"], capabilities: ["finance:close"] },
  { key: "reports/finance", app: "desktop", title: "Ön Muhasebe Raporları", requires: ["report:finance"], capabilities: [] },
  // Depo tarafı. ⚠️ `operations/yarn-stock` ve `operations/stock-counts` giriş
  // izni `warehouse:read`tir (backend `yarn.routes`/`stock-count.routes` ile
  // birebir); `yarn:write`/`warehouse:write` ekran İÇİ yetenektir.
  { key: "operations/goods-receipts", app: "desktop", title: "Mal Kabul", requires: ["goods-receipt:read"], capabilities: ["goods-receipt:write"] },
  { key: "operations/purchase-orders", app: "desktop", title: "Alış Siparişleri", requires: ["purchase-order:read", "purchase-order:write"], capabilities: [] },
  { key: "operations/yarn-stock", app: "desktop", title: "İplik Kg-Stok", requires: ["warehouse:read"], capabilities: ["yarn:write"] },
  { key: "operations/stock-counts", app: "desktop", title: "Stok Sayımı", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "operations/warehouse-transfers", app: "desktop", title: "Depo Transferi", requires: ["warehouse:transfer"], capabilities: [] },
  { key: "definitions/warehouses", app: "desktop", title: "Depolar", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "definitions/item-prices", app: "desktop", title: "Kalem Fiyatları", requires: ["item:read"], capabilities: ["price:write"] },
  // Cariler = müşteri + fason firma TEK listede (satın alma tarafı da cari
  // gördüğü için). Giriş izni İKİSİNDEN BİRİ yeter — route `requireAnyPermission`.
  { key: "definitions/cariler", app: "desktop", title: "Cariler", requires: ["customer:read", "subcontractor:read"], capabilities: ["customer:write", "subcontractor:write"] },
];

const mobile: ScreenEntry[] = [
  { key: "KK1", app: "mobile", title: "Ham Giriş", requires: ["mobile:kk1"], capabilities: [{ code: "mobile:kk1-desen", label: "Yeni desen (kumaş) oluşturabilir" }, { code: "mobile:kk1-yari-mamul", label: "Dışarıdan yarı mamul kabul edebilir" }, { code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }] },
  { key: "KursunQc", app: "mobile", title: "Kurşun", requires: ["mobile:kk2-kursun"], capabilities: [] },
  { key: "Tambur", app: "mobile", title: "Tambur", requires: ["mobile:tambur"], capabilities: [{ code: "mobile:tambur-duzelt", label: "Saha düzeltmesi: topu Tambur'a alma / manuel top" }, { code: "label:edit", label: "Etiketteki müşteri adını sipariş kalemi için düzeltebilir" }, { code: "customer-alias:write", label: "Müşterideki adı KALICI değiştirebilir" }, { code: "roll:manual-adjust", label: "Top metraj/kalite düzeltmesi" }] },
  { key: "Depo", app: "mobile", title: "Depo", requires: ["mobile:depo"], capabilities: [] },
  { key: "TartiPaket", app: "mobile", title: "Sevkiyat", requires: ["mobile:tarti-paket"], capabilities: [{ code: "mobile:sevkiyat", label: "Sevk çıkışı adımlarını da görebilir" }] },
  { key: "Sevkiyat", app: "mobile", title: "Sevk Çıkışı", requires: ["mobile:sevkiyat"], capabilities: [] },
  { key: "FasonSevk", app: "mobile", title: "Fason Sevk", requires: ["mobile:fason-sevk"], capabilities: [] },
  { key: "FasonKabul", app: "mobile", title: "Fason Mal Kabul", requires: ["mobile:fason-kabul"], capabilities: [] },
  { key: "KartelaSevk", app: "mobile", title: "Kartela Sevk", requires: ["mobile:kartela-sevk"], capabilities: [] },
  { key: "KartelaKabul", app: "mobile", title: "Kartela Kabul", requires: ["mobile:kartela-kabul"], capabilities: [] },
  { key: "IadeGirisi", app: "mobile", title: "İade Girişi", requires: ["mobile:iade"], capabilities: [] },
  { key: "HizliIsEmri", app: "mobile", title: "Hızlı İş Emri", requires: ["mobile:hizli-is-emri"], capabilities: [{ code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }] },
  { key: "Siparis", app: "mobile", title: "Sipariş", requires: ["mobile:siparis"], capabilities: [] },
  { key: "Kumas", app: "mobile", title: "Kumaş Ekle", requires: ["mobile:kumas"], capabilities: [] },
  { key: "KursunDagitim", app: "mobile", title: "Kurşun Dağıtım", requires: ["mobile:kursun-dagitim"], capabilities: [] },
];

/** Tüm ekranlar — masaüstü yetenek kodları etiketlenmiş hâlde. */
export const SCREEN_CATALOG: readonly ScreenEntry[] = [
  ...desktop.map((d) => ({
    ...d,
    capabilities: d.capabilities.map((code) => ({ code, label: capLabel(code) })),
  })),
  ...mobile,
];

/** Katalogda geçen TÜM yetki kodları (requires ∪ capabilities). */
export function screenCatalogCodes(): Set<string> {
  const out = new Set<string>();
  for (const s of SCREEN_CATALOG) {
    s.requires.forEach((c) => out.add(c));
    s.capabilities.forEach((c) => out.add(c.code));
  }
  return out;
}

/** Bir yetkiyi KULLANAN ekranlar — "bunu kaldırırsam nereler etkilenir". */
export function screensUsing(code: string): ScreenEntry[] {
  return SCREEN_CATALOG.filter(
    (s) => s.requires.includes(code) || s.capabilities.some((c) => c.code === code),
  );
}

/** Katalog dışında kalan izinler — API-içi/altyapı yetkileri (bekçi muafı). */
export const SCREENLESS_PERMISSIONS: ReadonlyArray<{ code: string; reason: string }> = [
  { code: "admin:*", reason: "Wildcard — tek tek ekran beyanı anlamsız." },
  { code: "mobile:*", reason: "Wildcard — tüm mobil ekranları kapsar." },
];

/** Katalogda adı geçmeyen izin var mı? (bekçi ve panel bandı kullanır) */
export function permissionsWithoutScreen(): string[] {
  const used = screenCatalogCodes();
  const exempt = new Set(SCREENLESS_PERMISSIONS.map((e) => e.code));
  return PERMISSION_CATALOG.map((p) => p.code).filter((c) => !used.has(c) && !exempt.has(c));
}
