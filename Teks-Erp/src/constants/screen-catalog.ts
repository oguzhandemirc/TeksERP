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

/**
 * Kapatılabilir modüller — TEK KAYNAK `constants/module-flags.ts` (`MODULE_FLAG_KEYS`).
 * Union burada YENİDEN yazılır çünkü `MODULE_FLAG_KEYS` bir `Set<string>`tir (tip
 * üretmez); ikilik `test_screen_catalog §7c` ile İKİ YÖNLÜ kilitlenir — liste
 * kopyalanmaz, bekçi import edip karşılaştırır.
 */
export type ModulKey =
  | "productionEnabled"
  | "financeEnabled"
  | "ticaretEnabled"
  | "iplikEnabled"
  | "depoMultiEnabled"
  | "kumasTeknikEnabled"
  | "tezgahEnabled"
  | "devereEnabled"
  | "dokumaEnabled"
  | "emanetEnabled";

/**
 * Kapatılamaz çekirdek bloklar (MODUL-BAYRAK-TASARIM §2).
 *
 * ⚠️ `cekirdek:` ÖN EKİ ZORUNLU: bir yazım hatasıyla ("ana-veri" ↔ "anaveri") bir
 * modül adının karışmaması için değil sadece — bekçi ve Sistem Profili ekranı
 * "bu ekran kapatılabilir bir modüle mi ait" sorusunu tek satırda
 * (`startsWith("cekirdek:")`) cevaplayabilsin diye.
 */
export type CekirdekBlok =
  | "cekirdek:ana-veri"
  | "cekirdek:stok-giris"
  | "cekirdek:siparis-musteri"
  | "cekirdek:sevkiyat-depo"
  | "cekirdek:sistem-kimlik-belge";

/**
 * Tasarımda VAR, kod anahtarı HENÜZ YOK (fason · kartela — tasarım §2 on modül
 * sayıyor, `module-flags.ts` yedi anahtar taşıyor).
 *
 * Değer GEÇİCİ BİR YER TUTUCU DEĞİL, bilgi taşır: bekçi bu ekranlara karo/kapı
 * hizası ARAMAZ (bağlanacak bayrak yok) ama "bilinmeyen değer" de saymaz. Gerçek
 * anahtar doğduğu gün `MODULE_FLAG_KEYS` ↔ `ModulKey` birebirlemesi taşımayı
 * görünür kılar — çekirdeğe konsalardı taşınmadıklarını hiçbir bekçi yakalamazdı.
 */
export type PlanlananModul = "planlanan:fason" | "planlanan:kartela";

export type EkranModul = ModulKey | CekirdekBlok | PlanlananModul;

/** Çalışma anında değer doğrulaması için (tip silinir, veri kalır). */
export const EKRAN_MODUL_DEGERLERI: ReadonlySet<string> = new Set<EkranModul>([
  "productionEnabled",
  "financeEnabled",
  "ticaretEnabled",
  "iplikEnabled",
  "depoMultiEnabled",
  "kumasTeknikEnabled",
  "tezgahEnabled",
  "devereEnabled",
  "dokumaEnabled",
  "emanetEnabled",
  "cekirdek:ana-veri",
  "cekirdek:stok-giris",
  "cekirdek:siparis-musteri",
  "cekirdek:sevkiyat-depo",
  "cekirdek:sistem-kimlik-belge",
  "planlanan:fason",
  "planlanan:kartela",
]);

export interface ScreenEntry {
  /** Mobilde ekran anahtarı (`KK1`), masaüstünde route yolu (`definitions/items`). */
  key: string;
  app: "mobile" | "desktop";
  /**
   * Bu ekran hangi modül kapanınca ANLAMSIZ kalır? (MODUL-BAYRAK-TASARIM §3)
   *
   * ZORUNLU alan — opsiyonel olsaydı yeni bir ekran hiç yazılmadan derlenir ve
   * tamlık kapısı tamamen bekçiye kalırdı; zorunluyken İLK kapı derleyicidir.
   *
   * ⚠️ AİDİYET BEYANIDIR, GÖRÜNÜRLÜK KURALI DEĞİL. Gizleme `visibleWhen`in işi:
   * `definitions/customers` çekirdek ana veridir ama karosu `!financeEnabled`
   * ile çizilir. Bu alanı menü süzmek için kullanan biri o ekranı finans
   * açıkken de gösterir. Alanın tüketicisi Sistem Profili ekranının
   * "kapatırsan şunlar gizlenir" ÖNİZLEMESİ ve bekçinin tamlık kapısıdır.
   */
  modul: EkranModul;
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
  "weavingorder:write": "Dokuma işi açıp düzenleyebilir, kapatıp iptal edebilir",
  "warpbeam:write": "Levent planlayıp sarabilir (iplik çıkışı ve dip iadesi yazar)",
  "warpbeam:cancel": "Sarımı iptal edebilir (iplik net geri döner)",
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
  { key: "definitions/items", app: "desktop", modul: "cekirdek:ana-veri", title: "Kumaşlar", requires: ["item:read"], capabilities: ["item:write"] },
  { key: "definitions/customers", app: "desktop", modul: "cekirdek:ana-veri", title: "Müşteriler", requires: ["customer:read"], capabilities: ["customer-alias:write", "customer:write", "label-template:write"] },
  { key: "definitions/stations", app: "desktop", modul: "cekirdek:ana-veri", title: "Üretim İstasyonları", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/machines", app: "desktop", modul: "cekirdek:ana-veri", title: "Makineler", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/peripherals", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Donanım", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/labels", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Etiketler", requires: ["station:read"], capabilities: ["label-template:read", "label-template:write"] },
  { key: "definitions/routes", app: "desktop", modul: "productionEnabled", title: "Üretim Rotaları", requires: ["station:read"], capabilities: ["property:write", "station:write"] },
  { key: "definitions/product-recipes", app: "desktop", modul: "productionEnabled", title: "İş Emri Şablonları", requires: ["station:read"], capabilities: ["station:write"] },
  // TEK EKRAN, DÖRT SEKME (fire · kayıt düzeltmesi · elle ekleme · iptal) —
  // düzenleme `roll:manual-adjust` YETENEĞİdir, ekranı görmek için gerekmez.
  { key: "definitions/reason-presets", app: "desktop", modul: "cekirdek:ana-veri", title: "Hazır Sebepler", requires: ["roll:read"], capabilities: ["roll:manual-adjust"] },
  // ÇUVAL İZLERİ — paketlemede çuvala bırakılan işaretlerin kataloğu; modül
  // AİDİYETİ sevkiyat/depo (yeni izin kodu YOK: okuma READ, yazma WRITE).
  { key: "definitions/sack-tags", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Çuval İzleri", requires: ["shipping:read"], capabilities: ["shipping:write"] },
  { key: "definitions/defect-types", app: "desktop", modul: "cekirdek:ana-veri", title: "Hata Tipleri", requires: ["quality:read"], capabilities: ["quality:write"] },
  // ÇÖZGÜ KARTLARI (devere Faz 1a) — bir çözgü tanımı N deseni besler; levent
  // bu karta göre sarılır. Modül kapalıyken karo çizilmez, uçlar 403 verir.
  { key: "definitions/warp-specs", app: "desktop", modul: "devereEnabled", title: "Çözgü Kartları", requires: ["warpspec:read"], capabilities: ["warpspec:write"] },
  { key: "definitions/quality-grades", app: "desktop", modul: "cekirdek:ana-veri", title: "Kalite Sınıfları", requires: ["quality:read"], capabilities: [] },
  { key: "definitions/colors", app: "desktop", modul: "cekirdek:ana-veri", title: "Renkler", requires: ["property:read"], capabilities: ["property:write"] },
  { key: "definitions/return-reasons", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "İade Nedenleri", requires: ["return:read"], capabilities: ["return:write"] },
  { key: "definitions/fabric-properties", app: "desktop", modul: "cekirdek:ana-veri", title: "Kumaş Özellikleri", requires: ["property:read"], capabilities: ["property:write"] },
  { key: "definitions/subcontractor-categories", app: "desktop", modul: "cekirdek:ana-veri", title: "Fason Kategorileri", requires: ["subcontractor:read"], capabilities: ["subcontractor:write"] },
  { key: "definitions/subcontractors", app: "desktop", modul: "cekirdek:ana-veri", title: "Fason Firmalar", requires: ["subcontractor:read"], capabilities: ["subcontractor:write"] },
  { key: "definitions/station-capabilities", app: "desktop", modul: "productionEnabled", title: "İstasyon Yetenekleri", requires: ["station:read"], capabilities: [] },
  { key: "definitions/label-templates", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Etiket Tasarımı", requires: ["label-template:read"], capabilities: ["label-template:write"] },
  { key: "access/devices", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Tabletler", requires: ["admin:settings"], capabilities: [] },
  { key: "access", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yetkilendirme", requires: ["admin:users"], capabilities: [] },
  { key: "access/users", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Kullanıcılar", requires: ["admin:users"], capabilities: [] },
  { key: "access/templates", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yetki Şablonları", requires: ["admin:users"], capabilities: [] },
  { key: "access/permissions", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yetki Kataloğu", requires: ["admin:users"], capabilities: [] },
  { key: "system", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sistem", requires: ["admin:settings"], capabilities: [] },
  { key: "system/activity", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Aktivite Günlüğü", requires: ["admin:settings"], capabilities: [] },
  { key: "system/perf", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Endpoint Performansı", requires: ["admin:settings"], capabilities: [] },
  { key: "system/server-status", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sunucu Durumu", requires: ["admin:settings"], capabilities: [] },
  { key: "system/clients", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Bağlı İstemciler", requires: ["admin:settings"], capabilities: [] },
  { key: "system/work-sessions", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Çalışma Oturumları", requires: ["admin:settings"], capabilities: [] },
  { key: "system/backups", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yedekler", requires: ["admin:settings"], capabilities: [] },
  // Veri Aktarımı — `admin:settings` DEĞİL: toplu yükleme sistem yönetimi değil
  // VERİ yönetimidir ve ayrı atanır. Ekranın kendisi `data:import` ile açılır;
  // hangi varlığa yazılabileceği ayrıca o varlığın write izniyle sınırlıdır
  // (uç guard'ı iki katmanlıdır — `import.routes.ts`).
  { key: "system/data-import", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Veri Aktarımı", requires: ["data:import"], capabilities: [] },
  // Mükerrer Kayıtlar — `admin:settings` DEĞİL: "bu iki müşteri aynı firma mı?"
  // sorusunun cevabını ana veriyi TANIYAN kişi (satış/planlama) bilir, sistem
  // yöneticisi bilmez. `capabilities` dört varlığın write iznidir: ekran
  // açılır ama birleştirme ikinci kapıyı da arar (`master-data-merge.routes`).
  { key: "system/duplicates", app: "desktop", modul: "cekirdek:ana-veri", title: "Mükerrer Kayıtlar", requires: ["master-data:merge"], capabilities: ["customer:write", "item:write", "property:write", "subcontractor:write"] },
  { key: "system/db-restore", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Veritabanı Geri Yükleme", requires: ["admin:settings"], capabilities: [] },
  // ⚠️ SATICI EKRANI ama modülü ÇEKİRDEK: modül anahtarlarının EVİ kendi
  // kilidinin arkasına konamaz (ayar ekranındaki `modules` kategorisiyle aynı
  // kural — kapılı olsaydı modüller bir daha yapılandırılamazdı). Keşfi kısan
  // şey KİMLİKTİR (`SystemTile.superadminOnly`), modül değil. 2026-09-03 / P5.
  { key: "system/module-profile", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Modüller", requires: ["admin:settings"], capabilities: [] },
  // Özellik Anahtarları — fabrikanın DAVRANIŞ bayrakları (2026-09-04'te Genel
  // Ayarlar'dan ayrıldı). ⚠️ Modülü ÇEKİRDEK ve bu bilinçli: ekran bir modüle
  // ait değil, modüllerin ÜSTÜNDE duran ayar yüzeyidir — satırları üretim,
  // ticaret, iplik ve muhasebe kategorilerine dağılır ve kategori bazında
  // KİLİTLENİR (`SettingsCategory.moduleKey`), gizlenmez.
  { key: "system/feature-flags", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Özellik Anahtarları", requires: ["admin:settings"], capabilities: [] },
  // Güncelleme — bu bilgisayardaki sürüm/güncelleme durumu. `settings:workstation`
  // DE yeter (yerel donanımını kuran personel); route çoklu kapılı olduğu için
  // bekçinin route çözücüsü bu satırı zaten göremez, giriş TAMLIK için var.
  { key: "system/update", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Güncelleme", requires: ["admin:settings", "settings:workstation"], capabilities: [] },
  { key: "system/logs", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sistem Kayıtları", requires: ["admin:settings"], capabilities: [] },
  { key: "system/archive", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Aktivite Arşivi", requires: ["admin:settings"], capabilities: [] },
  { key: "system/roll-archive", app: "desktop", modul: "cekirdek:stok-giris", title: "Top Arşivi", requires: ["admin:settings"], capabilities: [] },
  { key: "operations/orders", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Siparişler", requires: ["order:read"], capabilities: ["customer-alias:read", "order:write", "shipping:read", "workorder:write"] },
  { key: "operations/allocation-repair", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Siparişe yazılamayan sevkiyatlar", requires: ["shipping:repair-allocation"], capabilities: [] },
  { key: "operations/work-orders", app: "desktop", modul: "productionEnabled", title: "İş Emirleri", requires: ["workorder:read"], capabilities: ["order:write", "property:write", "roll:manual-adjust", "workorder:write"] },
  { key: "operations/rolls", app: "desktop", modul: "cekirdek:stok-giris", title: "Envanter", requires: ["roll:read"], capabilities: ["kartela:write", "label:print", "label:read", "roll:history", "roll:manual-adjust", "roll:write"] },
  { key: "operations/kursun-dagitim", app: "desktop", modul: "productionEnabled", title: "Kurşun Planlama", requires: ["quality:write", "workorder:distribute"], capabilities: [] },
  { key: "operations/product-balance", app: "desktop", modul: "productionEnabled", title: "Kumaş Dengesi", requires: ["workorder:read"], capabilities: ["workorder:write"] },
  { key: "operations/shipments", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Sevkiyatlar", requires: ["shipping:read"], capabilities: ["return:write", "shipping:invoice", "shipping:undo-dispatch", "shipping:write"] },
  { key: "operations/sack-store", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Sevk Kapısı", requires: ["shipping:read"], capabilities: ["shipping:write"] },
  { key: "operations/sack-content-edit", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Paketleme / Çuvallar", requires: ["shipping:write"], capabilities: ["label:print"] },
  { key: "operations/relabel-station", app: "desktop", modul: "cekirdek:stok-giris", title: "Yeniden Etiketle", requires: ["label:edit", "roll:write"], capabilities: [] },
  { key: "operations/accounting-dispatch", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Sevkiyatlar (Muhasebe)", requires: ["report:sales", "shipping:read"], capabilities: ["shipping:invoice"] },
  { key: "operations/kartela", app: "desktop", modul: "planlanan:kartela", title: "Kartela Takibi", requires: ["kartela:read"], capabilities: ["kartela:write"] },
  // Dokuma işi planlama (2026-09-13, ekran dilimi). Modül `dokumaEnabled` — üretime
  // bağımlı, tezgah izlemenin kardeşi; referans profilde KAPALI.
  { key: "operations/weaving-orders", app: "desktop", modul: "dokumaEnabled", title: "Dokuma İşleri", requires: ["weavingorder:read"], capabilities: ["weavingorder:write"] },
  // Leventler (devere Faz 1b, 2026-09-14): plan → sar → hazır levent; sarım iptali ayrı yetenek.
  { key: "operations/warp-beams", app: "desktop", modul: "devereEnabled", title: "Leventler", requires: ["warpbeam:read"], capabilities: ["warpbeam:write", "warpbeam:cancel"] },
  // Tezgah duruşları (Faz 1b web yüzeyi, 2026-09-14): elle giriş/kapatma/geri alma `loom:manual-entry`,
  // sebep atama/yeniden sınıflandırma `loom:classify` — İKİSİNDEN BİRİ ekranı açar, eylemler ekran içinde izinle.
  { key: "operations/machine-stops", app: "desktop", modul: "dokumaEnabled", title: "Tezgah Duruşları", requires: ["loom:manual-entry", "loom:classify"], capabilities: [] },
  { key: "operations/returns", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "İade Takibi", requires: ["return:read"], capabilities: ["return:write"] },
  { key: "reports/production", app: "desktop", modul: "productionEnabled", title: "Üretim", requires: ["report:production"], capabilities: [] },
  { key: "reports/sales", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Sipariş & Sevkiyat", requires: ["report:sales"], capabilities: [] },
  { key: "reports/quality", app: "desktop", modul: "productionEnabled", title: "Kalite", requires: ["report:quality"], capabilities: [] },
  { key: "reports/inventory", app: "desktop", modul: "cekirdek:stok-giris", title: "Stok & Depo", requires: ["report:inventory"], capabilities: [] },
  { key: "reports/subcontract", app: "desktop", modul: "planlanan:fason", title: "Fason", requires: ["report:subcontract"], capabilities: [] },
  { key: "reports/customer", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Müşteri", requires: ["report:customer"], capabilities: [] },
  { key: "reports/audit", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Denetim", requires: ["report:audit"], capabilities: [] },
  // ⚠️ AŞAĞIDAKİ BEŞİ ELLE EKLENDİ — route tarayıcısı bunları GÖREMEZ:
  // dördü `requireAnyPermission={DOCUMENT_DESIGN_READ}` gibi SABİT REFERANSLA
  // korunuyor (satır içi dizi değil), beşincisi ise route değil Genel Ayarlar
  // İÇİNDEKİ bir sekme. Bekçi bu iki biçimi de çözer; yeni bir sabit-referanslı
  // route eklenirse test kırmızı verir.
  { key: "definitions/document-templates", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Belge Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card", app: "desktop", modul: "productionEnabled", title: "Refakat Kartı", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card-studio", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Refakat Kartı Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "definitions/free-documents", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Serbest Belgeler", requires: ["admin:settings", "document-template:read", "document-template:write"], capabilities: ["document-template:write"] },
  { key: "settings", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Genel Ayarlar", requires: ["admin:settings", "settings:workstation"], capabilities: ["settings:workstation"] },

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
  { key: "finance", app: "desktop", modul: "financeEnabled", title: "Ön Muhasebe", requires: ["finance:read"], capabilities: [] },
  { key: "finance/cari", app: "desktop", modul: "financeEnabled", title: "Cari Hesaplar", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/invoices", app: "desktop", modul: "financeEnabled", title: "Faturalar", requires: ["finance:read"], capabilities: ["finance:invoice"] },
  { key: "finance/payments", app: "desktop", modul: "financeEnabled", title: "Tahsilat ve Ödemeler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/accounts", app: "desktop", modul: "financeEnabled", title: "Kasa ve Banka Hesapları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cash-transactions", app: "desktop", modul: "financeEnabled", title: "Kasa Hareketleri", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/rates", app: "desktop", modul: "financeEnabled", title: "Döviz Kurları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cheques", app: "desktop", modul: "financeEnabled", title: "Çek ve Senetler", requires: ["finance:read"], capabilities: ["finance:cheque"] },
  { key: "finance/allocations", app: "desktop", modul: "financeEnabled", title: "Tahsisler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/period-close", app: "desktop", modul: "financeEnabled", title: "Dönem Kapanışı", requires: ["finance:read"], capabilities: ["finance:close"] },
  { key: "reports/finance", app: "desktop", modul: "financeEnabled", title: "Ön Muhasebe Raporları", requires: ["report:finance"], capabilities: [] },
  // Dokuma raporları (Dilim 5, 2026-09-14): okuma `report:production` (1e hükmü ③); karne eylemleri ekran içi
  // PermissionGate — `loom:manual-entry` (terim düzelt · mühürle; machine-stops ekranıyla PAYLAŞILIR) ve
  // `loom:shift-unseal` (mühür aç; geçmiş rakamı değiştirir, SCREENLESS'tan düştü).
  { key: "reports/dokuma", app: "desktop", modul: "dokumaEnabled", title: "Dokuma Raporları", requires: ["report:production"], capabilities: ["loom:manual-entry", "loom:shift-unseal"] },
  // Depo tarafı. ⚠️ `operations/yarn-stock` ve `operations/stock-counts` giriş
  // izni `warehouse:read`tir (backend `yarn.routes`/`stock-count.routes` ile
  // birebir); `yarn:write`/`warehouse:write` ekran İÇİ yetenektir.
  { key: "operations/goods-receipts", app: "desktop", modul: "ticaretEnabled", title: "Mal Kabul", requires: ["goods-receipt:read"], capabilities: ["goods-receipt:write"] },
  { key: "operations/purchase-orders", app: "desktop", modul: "ticaretEnabled", title: "Alış Siparişleri", requires: ["purchase-order:read", "purchase-order:write"], capabilities: [] },
  { key: "operations/yarn-stock", app: "desktop", modul: "iplikEnabled", title: "İplik Kg-Stok", requires: ["warehouse:read"], capabilities: ["yarn:write"] },
  { key: "operations/stock-counts", app: "desktop", modul: "ticaretEnabled", title: "Stok Sayımı", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "operations/warehouse-transfers", app: "desktop", modul: "depoMultiEnabled", title: "Depo Transferi", requires: ["warehouse:transfer"], capabilities: [] },
  { key: "definitions/warehouses", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Depolar", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "definitions/item-prices", app: "desktop", modul: "ticaretEnabled", title: "Kalem Fiyatları", requires: ["item:read"], capabilities: ["price:write"] },
  // Cariler = müşteri + fason firma TEK listede (satın alma tarafı da cari
  // gördüğü için). Giriş izni İKİSİNDEN BİRİ yeter — route `requireAnyPermission`.
  { key: "definitions/cariler", app: "desktop", modul: "cekirdek:ana-veri", title: "Cariler", requires: ["customer:read", "subcontractor:read"], capabilities: ["customer:write", "subcontractor:write"] },
];

const mobile: ScreenEntry[] = [
  { key: "KK1", app: "mobile", modul: "productionEnabled", title: "Ham Giriş", requires: ["mobile:kk1"], capabilities: [{ code: "mobile:kk1-desen", label: "Yeni desen (kumaş) oluşturabilir" }, { code: "mobile:kk1-yari-mamul", label: "Dışarıdan yarı mamul kabul edebilir" }, { code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }] },
  { key: "KursunQc", app: "mobile", modul: "productionEnabled", title: "Kurşun", requires: ["mobile:kk2-kursun"], capabilities: [] },
  { key: "Tambur", app: "mobile", modul: "productionEnabled", title: "Tambur", requires: ["mobile:tambur"], capabilities: [{ code: "mobile:tambur-duzelt", label: "Saha düzeltmesi: topu Tambur'a alma / manuel top" }, { code: "label:edit", label: "Etiketteki müşteri adını sipariş kalemi için düzeltebilir" }, { code: "customer-alias:write", label: "Müşterideki adı KALICI değiştirebilir" }, { code: "roll:manual-adjust", label: "Top metraj/kalite düzeltmesi" }] },
  { key: "Depo", app: "mobile", modul: "cekirdek:stok-giris", title: "Depo", requires: ["mobile:depo"], capabilities: [] },
  { key: "TartiPaket", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: "Sevkiyat", requires: ["mobile:tarti-paket"], capabilities: [{ code: "mobile:sevkiyat", label: "Sevk çıkışı adımlarını da görebilir" }] },
  { key: "Sevkiyat", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: "Sevk Çıkışı", requires: ["mobile:sevkiyat"], capabilities: [] },
  { key: "FasonSevk", app: "mobile", modul: "planlanan:fason", title: "Fason Sevk", requires: ["mobile:fason-sevk"], capabilities: [] },
  { key: "FasonKabul", app: "mobile", modul: "planlanan:fason", title: "Fason Mal Kabul", requires: ["mobile:fason-kabul"], capabilities: [] },
  { key: "KartelaSevk", app: "mobile", modul: "planlanan:kartela", title: "Kartela Sevk", requires: ["mobile:kartela-sevk"], capabilities: [] },
  { key: "KartelaKabul", app: "mobile", modul: "planlanan:kartela", title: "Kartela Kabul", requires: ["mobile:kartela-kabul"], capabilities: [] },
  { key: "IadeGirisi", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: "İade Girişi", requires: ["mobile:iade"], capabilities: [] },
  { key: "HizliIsEmri", app: "mobile", modul: "productionEnabled", title: "Hızlı İş Emri", requires: ["mobile:hizli-is-emri"], capabilities: [{ code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }] },
  { key: "Siparis", app: "mobile", modul: "cekirdek:siparis-musteri", title: "Sipariş", requires: ["mobile:siparis"], capabilities: [] },
  { key: "Kumas", app: "mobile", modul: "cekirdek:ana-veri", title: "Kumaş Ekle", requires: ["mobile:kumas"], capabilities: [] },
  { key: "KursunDagitim", app: "mobile", modul: "productionEnabled", title: "Kurşun Dağıtım", requires: ["mobile:kursun-dagitim"], capabilities: [] },
  // Tablet TEZGAH ekranı (2026-09-14, dokuma dilimi): top indirme + geri alma; koşum/duruş sonraki dilim.
  { key: "Dokuma", app: "mobile", modul: "dokumaEnabled", title: "Tezgah", requires: ["mobile:dokuma"], capabilities: [{ code: "mobile:dokuma-geri-al", label: "Top indirmeyi, koşumu ve duruşu geri alabilir" }] },
  // Tablet LEVENT SARIM ekranı (2026-09-14, DEVERE-LEVENT-TARAMASI §11): plan · sar · taslak sil; iptal yetenek.
  { key: "Devere", app: "mobile", modul: "devereEnabled", title: "Levent Sarım", requires: ["mobile:devere"], capabilities: [{ code: "mobile:devere-iptal", label: "Sarımı iptal edebilir (iplik defterine ters satır)" }] },
  // G2t (2026-09-14): fason dokuma kabulü — aynı izin ikinci ekranda (levent dönüşü + top kabulü; sevk/iptal panelden).
  { key: "FasonDokuma", app: "mobile", modul: "dokumaEnabled", title: "Fason Dokuma Kabul", requires: ["mobile:fason-kabul"], capabilities: [] },
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

/**
 * Bir modül/blok kapanınca gizlenecek ekranlar — Sistem Profili önizlemesi + bekçi.
 *
 * ⚠️ "Gizlenecek" ifadesi ÖNİZLEME dilidir: gerçek gizleme kararı karonun
 * `visibleWhen` yüklemindedir (bkz. `ScreenEntry.modul` notu).
 */
export function screensOfModul(m: EkranModul): ScreenEntry[] {
  return SCREEN_CATALOG.filter((s) => s.modul === m);
}

/** Modül/blok → ekran sayısı (panel kartındaki "12 ekran gizlenecek" rozeti). */
export function screenCountByModul(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SCREEN_CATALOG) out[s.modul] = (out[s.modul] ?? 0) + 1;
  return out;
}

/**
 * Ekranı OLMAYAN modüller — GEREKÇELİ (`SCREENLESS_PERMISSIONS` ikizi).
 *
 * Bekçi üç şeyi birden sorar: (a) her `ModulKey` ya ≥1 ekran taşır ya burada
 * muaftır, (b) muaf bir modüle ekran eşlenmişse liste BAYATTIR (ölü muaf →
 * kırmızı), (c) gerekçe yazılıdır. Ölü muaf kuralı, "Dilim 3'te yüzey doğunca
 * burayı silmeyi unutma" hatırlatmasını mekanik hâle getirir.
 */
export const EKRANSIZ_MODULLER: ReadonlyArray<{ modul: ModulKey; reason: string }> = [
  {
    modul: "kumasTeknikEnabled",
    reason:
      "Kumaş teknik kartı = Kumaşlar ekranının İÇİNDEKİ alanlar (en · gramaj · " +
      "kompozisyon); ayrı bir ekranı yok. Yüzey Dilim 3'te doğacak.",
  },
  {
    modul: "tezgahEnabled",
    reason:
      "Dokuma tezgah izleme yer tutucu bir anahtar — arkasında henüz hiçbir " +
      "yüzey (ne route ne karo) yok. Dilim 4.",
  },
  {
    modul: "emanetEnabled",
    reason:
      "Emanet (konsinye mülkiyet) ekransız modül: yazma kapısı + veri niteliği — " +
      "sahip alanı KK1/levent/lot formlarının İÇİNDE yaşar, ayrı ekranı/karosu yok (G3).",
  },
];

/** Katalog dışında kalan izinler — API-içi/altyapı yetkileri (bekçi muafı). */
export const SCREENLESS_PERMISSIONS: ReadonlyArray<{ code: string; reason: string }> = [
  { code: "admin:*", reason: "Wildcard — tek tek ekran beyanı anlamsız." },
  { code: "mobile:*", reason: "Wildcard — tüm mobil ekranları kapsar." },
  // Dokuma P2b (2026-09-13): koşum yazma yüzeyi backend'de doğdu, ekranı tablet
  // TEZGAH ekranıdır (DOKUMA-IS-EMRI §3.2) ve henüz yok. Ekran doğduğu gün bu iki
  // satır ölü muaf olur ve bekçi kırmızı verir — silinmesi o dilimin işidir.
  // Koşumun tablet yüzeyi DOĞDU (2026-09-14): tablet `mobile:dokuma` / `mobile:dokuma-geri-al` ile
  // çağırır; `loom:*` web kodları panelsiz kalır (panel koşum yüzeyi yok, kod API/entegrasyon için).
  { code: "loom:run", reason: "Panel koşum yüzeyi yok; tablet `mobile:dokuma` ile açar/kapatır — web kodu API/entegrasyon için." },
  { code: "loom:run-revoke", reason: "Panel geri alma yüzeyi yok; tablet `mobile:dokuma-geri-al` ile — web kodu API/entegrasyon için." },
  // Dokuma P3b (2026-09-13): doff yazma yüzeyi backend'de doğdu; ekranı tablet tezgah
  // ekranının "İndir" eylemi (DOKUMA-IS-EMRI §3.4) ve henüz yok — ekranla ölü muaf olur.
  // Doff'un tablet yüzeyi DOĞDU (2026-09-14): tablet `mobile:dokuma` / `mobile:dokuma-geri-al` ile
  // çağırır; `loom:*` web kodları panelsiz kalır — panel doff yüzeyi yok, kod API/entegrasyon için.
  { code: "loom:doff", reason: "Panel doff yüzeyi yok; tablet `mobile:dokuma` ile kaydeder — web kodu API/entegrasyon için." },
  { code: "loom:doff-revoke", reason: "Panel geri alma yüzeyi yok; tablet `mobile:dokuma-geri-al` ile — web kodu API/entegrasyon için." },
  // Tezgah künyesi + gölge mod (B3, 2026-09-14): "Devreye Alma" ekranı AYRI dilim (Faz 2 ingest ile, `tezgah.enabled`).
  { code: "loom:spec-manage", reason: "Devreye Alma ekranı ayrı dilim (Faz 2 ingest ile doğar); künye/gölge mod uçları API için." },
];

/** Katalogda adı geçmeyen izin var mı? (bekçi ve panel bandı kullanır) */
export function permissionsWithoutScreen(): string[] {
  const used = screenCatalogCodes();
  const exempt = new Set(SCREENLESS_PERMISSIONS.map((e) => e.code));
  return PERMISSION_CATALOG.map((p) => p.code).filter((c) => !used.has(c) && !exempt.has(c));
}
