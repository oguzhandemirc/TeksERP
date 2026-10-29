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
import { TERIM, TERIM_AD } from "./terim";
import { capLabel } from "./screen-capability-labels";

export { capLabel };

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
  | "emanetEnabled"
  | "kaliteGuvenceEnabled"
  | "maliyetEnabled"
  | "gelenBelgeEnabled";

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
  "kaliteGuvenceEnabled",
  "maliyetEnabled",
  "gelenBelgeEnabled",
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

const desktop: Array<Omit<ScreenEntry, "capabilities"> & { capabilities: string[] }> = [
  { key: "definitions/items", app: "desktop", modul: "cekirdek:ana-veri", title: "Ürünler", requires: ["item:read"], capabilities: ["customer-alias:read", "customer-alias:write", "item:write"] },
  { key: "definitions/customers", app: "desktop", modul: "cekirdek:ana-veri", title: "Müşteriler", requires: ["customer:read"], capabilities: ["customer-alias:write", "customer:write", "label-template:write"] },
  { key: "definitions/stations", app: "desktop", modul: "cekirdek:ana-veri", title: "Üretim İstasyonları", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/machines", app: "desktop", modul: "cekirdek:ana-veri", title: "Makineler", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/peripherals", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Donanım", requires: ["station:read"], capabilities: ["station:write"] },
  { key: "definitions/labels", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Etiketler", requires: ["station:read"], capabilities: ["label-template:read", "label-template:write"] },
  { key: "definitions/routes", app: "desktop", modul: "productionEnabled", title: "Üretim Rotaları", requires: ["station:read"], capabilities: ["property:write", "station:write"] },
  { key: "definitions/product-recipes", app: "desktop", modul: "productionEnabled", title: `${TERIM.terbiyeIsEmri.tekil} Şablonları`, requires: ["station:read"], capabilities: ["station:write"] },
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
  { key: "access/patron-bulut", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yönetim Bulutu", requires: ["admin:users"], capabilities: [] },
  // Sistem hub'ı: karolarından BİRİNİ açabilen herkes girer (Electron `SYSTEM_HUB_ACCESS` aynası).
  { key: "documents", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: TERIM_AD.belgeler, requires: ["station:read", "label-template:read", "admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: [] },
  { key: "system", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sistem", requires: ["admin:settings", "data:import", "master-data:merge", "settings:numbering", "settings:workstation", "settings:customers", "settings:orders", "settings:shipping", "settings:work-orders", "settings:production", "settings:kartela", "settings:devere", "settings:dokuma", "settings:warehouse", "settings:yarn", "settings:finance", "settings:label", "settings:devices", "settings:company", "settings:e-irsaliye", "settings:session", "system:activity", "system:work-sessions", "system:server-status", "system:clients", "system:backups", "system:print-history", "license:view", "license:manage", "support:create", "settings:notifications"], capabilities: [] },
  { key: "system/activity", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: TERIM_AD.etkinlikGunlugu, requires: ["admin:settings", "system:activity"], capabilities: [] },
  // bildirim: kişisel gelen kutusu — kapısız (izin kodu yok; satır kapsamı kişinin kendi kutusu).
  { key: "notifications", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Bildirimler", requires: [], capabilities: [] },
  { key: "settings/notifications", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Bildirim tercihleri", requires: [], capabilities: [] },
  { key: "system/perf", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Endpoint Performansı", requires: ["admin:settings"], capabilities: [] },
  { key: "system/server-status", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sunucu Durumu", requires: ["admin:settings", "system:server-status"], capabilities: ["system:backups"] },
  { key: "system/print-history", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yazdırma Geçmişi", requires: ["admin:settings", "system:print-history"], capabilities: [] },
  { key: "system/clients", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Bağlı İstemciler", requires: ["admin:settings", "system:clients"], capabilities: [] },
  { key: "system/work-sessions", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Çalışma Oturumları", requires: ["admin:settings", "system:work-sessions"], capabilities: [] },
  { key: "system/backups", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Yedekler", requires: ["admin:settings", "system:backups"], capabilities: [] },
  // Lisans + Hakkında (panel yüzeyi Faz 1d). Hakkında'nın verisi herkese açık `GET /api/license/durum`.
  { key: "system/license", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Lisans", requires: ["license:view", "license:manage"], capabilities: ["license:manage"] },
  { key: "system/about", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Hakkında", requires: ["license:view"], capabilities: [] },
  { key: "system/support", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Destek", requires: ["support:create"], capabilities: ["support:create"] },
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
  { key: "system/read-only-db", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Veritabanı Okuma Erişimi", requires: ["admin:settings"], capabilities: [] },
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
  // Her sekme kendi izniyle açılır (`constants/settings-scopes.ts`); ekran, sekmelerden birini açabilene görünür.
  { key: "system/feature-flags", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Özellik Anahtarları", requires: ["admin:settings", "settings:customers", "settings:orders", "settings:shipping", "settings:work-orders", "settings:production", "settings:kartela", "settings:devere", "settings:dokuma", "settings:warehouse", "settings:yarn", "settings:finance"], capabilities: [] },
  // Genel Ayarlar 2026-09-24'te üç ekrana bölündü; her biri kendi sekmelerinin izinleriyle açılır.
  { key: "system/printing", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Baskı & Cihazlar", requires: ["admin:settings", "settings:label", "settings:devices"], capabilities: [] },
  { key: "system/workstation", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Bu Bilgisayar", requires: ["admin:settings", "settings:workstation"], capabilities: [] },
  { key: "system/company", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Şirket & Güvenlik", requires: ["admin:settings", "settings:company", "settings:e-irsaliye", "settings:session"], capabilities: [] },
  // Numaralandırma — numara BİÇİMİ veri olduğundan panelden yönetilir (Faz C).
  // Çekirdek: her kurulumda numara üretilir, kapatılabilir bir modüle ait değil.
  { key: "system/numbering", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Numaralandırma", requires: ["settings:numbering"], capabilities: [] },
  { key: "system/logs", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Sistem Kayıtları", requires: ["admin:settings", "system:activity"], capabilities: [] },
  // Arşive TAŞIMA süperadmin ekranıdır (karo `superadminOnly`); alt yol Arşiv Tarama okuma iznini de kabul eder.
  { key: "system/archive", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: TERIM_AD.etkinlikArsivi, requires: ["admin:settings", "system:activity"], capabilities: [] },
  { key: "system/roll-archive", app: "desktop", modul: "cekirdek:stok-giris", title: "Top Arşivi", requires: ["admin:settings", "roll:read"], capabilities: [] },
  { key: "operations/orders", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Siparişler", requires: ["order:read"], capabilities: ["customer-alias:read", "order:write", "shipping:read", "workorder:write"] },
  { key: "operations/allocation-repair", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Siparişe yazılamayan sevkiyatlar", requires: ["shipping:repair-allocation"], capabilities: [] },
  { key: "operations/work-orders", app: "desktop", modul: "productionEnabled", title: TERIM.terbiyeIsEmri.cogul, requires: ["workorder:read"], capabilities: ["order:write", "property:write", "roll:manual-adjust", "workorder:write"] },
  { key: "operations/work-order-events", app: "desktop", modul: "productionEnabled", title: `${TERIM.terbiyeIsEmri.tekil} Hareketleri`, requires: ["workorder:read"], capabilities: [] },
  { key: "operations/rolls", app: "desktop", modul: "cekirdek:stok-giris", title: "Kumaş Stoğu", requires: ["roll:read"], capabilities: ["kartela:write", "label:print", "label:read", "roll:history", "roll:manual-adjust", "roll:write"] },
  { key: "operations/kursun-sapmalar", app: "desktop", modul: "productionEnabled", title: "Metre Sapmaları", requires: ["kursun:meter-approve"], capabilities: [] },
  { key: "operations/kursun-dagitim", app: "desktop", modul: "productionEnabled", title: TERIM_AD.kursunPlanlama, requires: ["quality:write", "workorder:distribute"], capabilities: [] },
  { key: "operations/product-balance", app: "desktop", modul: "productionEnabled", title: "Kumaş Dengesi", requires: ["workorder:read"], capabilities: ["workorder:write"] },
  { key: "operations/shipments", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Sevkiyatlar", requires: ["shipping:read"], capabilities: ["eirsaliye:read", "eirsaliye:undo", "eirsaliye:write", "return:write", "shipping:invoice", "shipping:undo-dispatch", "shipping:write"] },
  { key: "operations/sack-store", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Sevk Kapısı", requires: ["shipping:read"], capabilities: ["shipping:write"] },
  { key: "operations/sack-content-edit", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Paketleme / Çuvallar", requires: ["shipping:write"], capabilities: ["label:print", "shipping:packing-lot"] },
  { key: "operations/relabel-station", app: "desktop", modul: "cekirdek:stok-giris", title: "Yeniden Etiketle", requires: ["label:edit", "roll:write"], capabilities: [] },
  { key: "operations/accounting-dispatch", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: TERIM_AD.sevkEdilenler, requires: ["report:sales", "shipping:read"], capabilities: ["shipping:invoice"] },
  { key: "operations/kartela", app: "desktop", modul: "planlanan:kartela", title: "Kartela Takibi", requires: ["kartela:read"], capabilities: ["kartela:write"] },
  // Dokuma işi planlama (2026-09-13, ekran dilimi). Modül `dokumaEnabled` — üretime
  // bağımlı, tezgah izlemenin kardeşi; referans profilde KAPALI.
  { key: "operations/weaving-orders", app: "desktop", modul: "dokumaEnabled", title: TERIM.dokumaIsEmri.cogul, requires: ["weavingorder:read"], capabilities: ["weavingorder:write"] },
  // Leventler (devere Faz 1b, 2026-09-14): plan → sar → hazır levent; sarım iptali ayrı yetenek.
  { key: "operations/warp-beams", app: "desktop", modul: "devereEnabled", title: "Leventler", requires: ["warpbeam:read"], capabilities: ["warpbeam:write", "warpbeam:cancel"] },
  // Tezgah duruşları (Faz 1b web yüzeyi, 2026-09-14): elle giriş/kapatma/geri alma `loom:manual-entry`,
  // sebep atama/yeniden sınıflandırma `loom:classify` — İKİSİNDEN BİRİ ekranı açar, eylemler ekran içinde izinle.
  { key: "operations/machine-stops", app: "desktop", modul: "dokumaEnabled", title: "Tezgah Duruşları", requires: ["loom:manual-entry", "loom:classify"], capabilities: [] },
  // Vardiya Tanımları (2026-10-10): katalog yazma yüzeyi `loom:spec-manage`; Tanımlar karosu.
  { key: "definitions/shift-definitions", app: "desktop", modul: "dokumaEnabled", title: "Vardiya Tanımları", requires: ["loom:spec-manage"], capabilities: [] },
  // Tezgah Salonu canlı ekranı (2026-10-10): `tezgahEnabled` arkasında — dokuma modülünün değil
  // tezgah izlemenin ekranı (DOKUMA-CANLI-EKRAN §8 karar 6).
  // Koşum eylemleri (İş ver · Değiştir · Bitir · Geri al) ekran içinde yalnız dokuma açıkken doğar (`test_dokuma_regime_gate §7f`).
  { key: "operations/weaving-floor", app: "desktop", modul: "tezgahEnabled", title: "Tezgah Salonu", requires: ["loom:live-view"], capabilities: ["loom:run", "loom:run-revoke", "loom:manual-entry", "loom:classify"] },
  // Tezgah Alarmları (A2a, 2026-10-11): liste + alarm sayfası; eylemler sayfa içinde izinle. Alarm bayrağı
  // modül değil davranış bayrağıdır — ekranın modülü tezgah izleme.
  { key: "operations/loom-alarms", app: "desktop", modul: "tezgahEnabled", title: TERIM_AD.tezgahAlarmlari, requires: ["loom:alarm-view"], capabilities: ["loom:alarm-ack", "loom:alarm-escalation"] },
  { key: "definitions/loom-alarm-duty", app: "desktop", modul: "tezgahEnabled", title: "Alarm Sorumluları", requires: ["loom:spec-manage"], capabilities: [] },
  { key: "definitions/machine-collectors", app: "desktop", modul: "tezgahEnabled", title: TERIM_AD.makineVeriToplayicilari, requires: ["loom:spec-manage"], capabilities: [] },
  { key: "definitions/machine-stop-codes", app: "desktop", modul: "tezgahEnabled", title: "Duruş Kodu Eşleme", requires: ["loom:spec-manage"], capabilities: [] },
  { key: "operations/returns", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "İade Takibi", requires: ["return:read"], capabilities: ["return:write"] },
  { key: "operations/e-irsaliye", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "e-İrsaliye Kayıtları", requires: ["eirsaliye:read"], capabilities: [] },
  { key: "reports/production", app: "desktop", modul: "productionEnabled", title: "Üretim", requires: ["report:production"], capabilities: [] },
  { key: "reports/sales", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Sipariş & Sevkiyat", requires: ["report:sales"], capabilities: [] },
  { key: "reports/quality", app: "desktop", modul: "productionEnabled", title: "Kalite", requires: ["report:quality"], capabilities: [] },
  { key: "reports/inventory", app: "desktop", modul: "cekirdek:stok-giris", title: "Stok & Depo", requires: ["report:inventory"], capabilities: [] },
  { key: "reports/subcontract", app: "desktop", modul: "planlanan:fason", title: "Fason", requires: ["report:subcontract"], capabilities: [] },
  { key: "reports/customer", app: "desktop", modul: "cekirdek:siparis-musteri", title: "Müşteri", requires: ["report:customer"], capabilities: [] },
  { key: "reports/audit", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Denetim", requires: ["report:audit"], capabilities: [] },
  // ⚠️ AŞAĞIDAKİ DÖRDÜ ELLE EKLENDİ — route tarayıcısı bunları GÖREMEZ:
  // `requireAnyPermission={DOCUMENT_DESIGN_READ}` gibi SABİT REFERANSLA
  // korunuyorlar (satır içi dizi değil). Yeni bir sabit-referanslı route
  // eklenirse test kırmızı verir.
  { key: "definitions/document-templates", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Belge Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card", app: "desktop", modul: "productionEnabled", title: "Refakat Kartı", requires: ["admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: ["document-template:write"] },
  { key: "definitions/traveler-card-studio", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Refakat Kartı Şablonları", requires: ["admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: ["document-template:write"] },
  { key: "definitions/free-documents", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Serbest Belgeler", requires: ["admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: ["document-template:write"] },
  // T2 iskeleti: Belge Şablonları ile aynı izin kümesi (T5).
  { key: "definitions/document-designer", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Belge Tasarımcısı", requires: ["admin:settings", "document-template:read", "document-template:write", "document-template:design", "document-template:publish"], capabilities: ["document-template:design", "document-template:publish"] },

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
  { key: "finance", app: "desktop", modul: "financeEnabled", title: TERIM_AD.onMuhasebe, requires: ["finance:read"], capabilities: [] },
  { key: "finance/cari", app: "desktop", modul: "financeEnabled", title: "Cari Hesaplar", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/invoices", app: "desktop", modul: "financeEnabled", title: "Faturalar", requires: ["finance:read"], capabilities: ["finance:invoice"] },
  { key: "finance/payments", app: "desktop", modul: "financeEnabled", title: "Tahsilat ve Ödemeler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/accounts", app: "desktop", modul: "financeEnabled", title: "Kasa ve Banka Hesapları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cash-transactions", app: "desktop", modul: "financeEnabled", title: "Kasa Hareketleri", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/rates", app: "desktop", modul: "financeEnabled", title: "Döviz Kurları", requires: ["finance:read"], capabilities: ["finance:write"] },
  { key: "finance/cheques", app: "desktop", modul: "financeEnabled", title: "Çek ve Senetler", requires: ["finance:read"], capabilities: ["finance:cheque"] },
  { key: "finance/allocations", app: "desktop", modul: "financeEnabled", title: "Tahsisler", requires: ["finance:read"], capabilities: ["finance:payment"] },
  { key: "finance/period-close", app: "desktop", modul: "financeEnabled", title: "Dönem Kapanışı", requires: ["finance:read"], capabilities: ["finance:close"] },
  // Raporlar v2 kayıtlı/özel raporlar (R1-KAYIT): oluşturma/düzenleme builder; kategori, herkese açma
  // ve başkasının koşusunu durdurma publish. Görüntüleme (`reports/kayitli/:id`) kapısızdır — görünürlük uçta.
  { key: "reports/ozel", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: "Özel rapor oluştur", requires: ["report:builder"], capabilities: ["report:publish"] },
  { key: "reports/finance", app: "desktop", modul: "financeEnabled", title: "Ön Muhasebe Raporları", requires: ["report:finance"], capabilities: [] },
  // Dokuma raporları (Dilim 5, 2026-09-14): okuma `report:production` (1e hükmü ③); karne eylemleri ekran içi
  // PermissionGate — `loom:manual-entry` (terim düzelt · mühürle; machine-stops ekranıyla PAYLAŞILIR) ve
  // `loom:shift-unseal` (mühür aç; geçmiş rakamı değiştirir, SCREENLESS'tan düştü).
  { key: "reports/dokuma", app: "desktop", modul: "dokumaEnabled", title: "Dokuma Raporları", requires: ["report:production"], capabilities: ["loom:manual-entry", "loom:shift-unseal"] },
  { key: "reports/maliyet", app: "desktop", modul: "maliyetEnabled", title: "Maliyet Raporları", requires: ["report:yarn-need"], capabilities: [] },
  // Depo tarafı. ⚠️ `operations/yarn-stock` ve `operations/stock-counts` giriş
  // izni `warehouse:read`tir (backend `yarn.routes`/`stock-count.routes` ile
  // birebir); `yarn:write`/`warehouse:write` ekran İÇİ yetenektir.
  { key: "operations/goods-receipts", app: "desktop", modul: "ticaretEnabled", title: "Mal Kabul", requires: ["goods-receipt:read"], capabilities: ["goods-receipt:write"] },
  // Gelen belge (Gülkesim OCR D5): onay SoD yeteneğidir (Muhasebe/Süpervizör) — emanet topunu doğurur.
  { key: "operations/gelen-belgeler", app: "desktop", modul: "gelenBelgeEnabled", title: "Gelen Belgeler", requires: ["gelen-belge:read"], capabilities: ["gelen-belge:write", "gelen-belge:approve", "gelen-belge:template"] },
  { key: "operations/purchase-orders", app: "desktop", modul: "ticaretEnabled", title: "Alış Siparişleri", requires: ["purchase-order:read", "purchase-order:write"], capabilities: [] },
  { key: "operations/yarn-stock", app: "desktop", modul: "iplikEnabled", title: "İplik Stoğu", requires: ["warehouse:read"], capabilities: ["yarn:write", "quality:write"] },
  { key: "operations/stock-counts", app: "desktop", modul: "ticaretEnabled", title: "Stok Sayımı", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "operations/warehouse-transfers", app: "desktop", modul: "depoMultiEnabled", title: "Depo Transferi", requires: ["warehouse:transfer"], capabilities: [] },
  { key: "definitions/warehouses", app: "desktop", modul: "cekirdek:sevkiyat-depo", title: "Depolar", requires: ["warehouse:read"], capabilities: ["warehouse:write"] },
  { key: "definitions/item-prices", app: "desktop", modul: "ticaretEnabled", title: "Kalem Fiyatları", requires: ["item:read"], capabilities: ["price:write"] },
  // Cariler = müşteri + fason firma TEK listede (satın alma tarafı da cari
  // gördüğü için). Giriş izni İKİSİNDEN BİRİ yeter — route `requireAnyPermission`.
  { key: "definitions/cariler", app: "desktop", modul: "cekirdek:ana-veri", title: "Cariler", requires: ["customer:read", "subcontractor:read"], capabilities: ["customer:write", "subcontractor:write"] },
  // Kalite Güvence (K4P zemin, 2026-10-24): manifesto önden yazıldı; panel sayfaları PANEL/LAB/SERT
  // dilimlerinde iner (karo yok → bekçide KARO_YOK muafı, karo doğunca muaf ölür).
  { key: "quality", app: "desktop", modul: "kaliteGuvenceEnabled", title: TERIM_AD.kaliteGuvence, requires: ["inspection:read", "labtest:read", "certificate:read"], capabilities: [] },
  { key: "quality/inspections", app: "desktop", modul: "kaliteGuvenceEnabled", title: "Muayeneler", requires: ["inspection:read"], capabilities: ["inspection:write", "inspection:correct"] },
  { key: "quality/inspection-rules", app: "desktop", modul: "kaliteGuvenceEnabled", title: "4 Puan Kuralları", requires: ["inspection:read"], capabilities: ["inspection:rules"] },
  { key: "quality/lab-tests", app: "desktop", modul: "kaliteGuvenceEnabled", title: "Lab Testleri", requires: ["labtest:read"], capabilities: ["labtest:write", "labtest:approve"] },
  { key: "quality/certificates", app: "desktop", modul: "kaliteGuvenceEnabled", title: "Sertifikalar", requires: ["certificate:read"], capabilities: ["certificate:write"] },
  // Maliyet & Teklif (MAL-3): görüntüleme `cost:read` (uçların okuma izni); yazma ekran İÇİ yetenek.
  // Hub'a maliyet, teklif ya da fiyat listesi okuyan girer (MAL-5) — giriş izni herhangi biri (route requireAnyPermission).
  { key: "cost", app: "desktop", modul: "maliyetEnabled", title: "Maliyet & Teklif", requires: ["cost:read", "quote:read", "price-list:read", "report:yarn-need"], capabilities: [] },
  { key: "cost/parameters", app: "desktop", modul: "maliyetEnabled", title: "Maliyet Parametreleri", requires: ["cost:read"], capabilities: ["cost:settings"] },
  { key: "cost/yarn-prices", app: "desktop", modul: "maliyetEnabled", title: "İplik Maliyet Fiyatları", requires: ["cost:read"], capabilities: ["cost:write"] },
  { key: "cost/finishing-rates", app: "desktop", modul: "maliyetEnabled", title: "Fason Tarifeleri", requires: ["cost:read"], capabilities: ["cost:write"] },
  { key: "cost/items", app: "desktop", modul: "maliyetEnabled", title: "Maliyet Kartları", requires: ["cost:read"], capabilities: ["cost:write"] },
  { key: "cost/calculator", app: "desktop", modul: "maliyetEnabled", title: "Hızlı Hesaplayıcı", requires: ["cost:read"], capabilities: ["quote:write"] },
  { key: "cost/quotes", app: "desktop", modul: "maliyetEnabled", title: "Teklifler", requires: ["quote:read"], capabilities: ["quote:write", "quote:convert"] },
  { key: "cost/price-lists", app: "desktop", modul: "maliyetEnabled", title: "Fiyat Listeleri", requires: ["price-list:read"], capabilities: ["price-list:write"] },
  { key: "cost/yarn-need", app: "desktop", modul: "maliyetEnabled", title: "İplik İhtiyaç Planı", requires: ["report:yarn-need"], capabilities: [] },
  // bildirim: yönetici bildirim profilleri (N4-SEMA izni; sayfa + rota + karo N4-PROFIL'de).
  { key: "system/notification-profiles", app: "desktop", modul: "cekirdek:sistem-kimlik-belge", title: TERIM_AD.bildirimProfilleri, requires: ["settings:notifications", "admin:settings"], capabilities: [] },
];

const mobile: ScreenEntry[] = [
  { key: "KK1", app: "mobile", modul: "productionEnabled", title: "Ham Giriş", requires: ["mobile:kk1"], capabilities: [{ code: "mobile:kk1-desen", label: "Yeni desen (kumaş) oluşturabilir" }, { code: "mobile:kk1-yari-mamul", label: "Dışarıdan yarı mamul kabul edebilir" }, { code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }] },
  { key: "KursunQc", app: "mobile", modul: "productionEnabled", title: "Kurşun", requires: ["mobile:kk2-kursun"], capabilities: [] },
  { key: "Tambur", app: "mobile", modul: "productionEnabled", title: "Tambur", requires: ["mobile:tambur"], capabilities: [{ code: "mobile:tambur-duzelt", label: "Saha düzeltmesi: topu Tambur'a alma / manuel top" }, { code: "label:edit", label: "Etiketteki müşteri adını sipariş kalemi için düzeltebilir" }, { code: "customer-alias:write", label: "Müşterideki adı KALICI değiştirebilir" }, { code: "roll:manual-adjust", label: "Top metraj/kalite düzeltmesi" }] },
  { key: "Depo", app: "mobile", modul: "cekirdek:stok-giris", title: "Depo", requires: ["mobile:depo"], capabilities: [] },
  { key: "TartiPaket", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: TERIM_AD.tartiPaket, requires: ["mobile:tarti-paket"], capabilities: [{ code: "mobile:sevkiyat", label: "Sevk çıkışı adımlarını da görebilir" }] },
  { key: "Sevkiyat", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: "Sevk Çıkışı", requires: ["mobile:sevkiyat"], capabilities: [] },
  { key: "FasonSevk", app: "mobile", modul: "planlanan:fason", title: "Fason Sevk", requires: ["mobile:fason-sevk"], capabilities: [] },
  { key: "FasonKabul", app: "mobile", modul: "planlanan:fason", title: "Fason Mal Kabul", requires: ["mobile:fason-kabul"], capabilities: [] },
  { key: "KartelaSevk", app: "mobile", modul: "planlanan:kartela", title: "Kartela Sevk", requires: ["mobile:kartela-sevk"], capabilities: [] },
  { key: "KartelaKabul", app: "mobile", modul: "planlanan:kartela", title: "Kartela Kabul", requires: ["mobile:kartela-kabul"], capabilities: [] },
  { key: "IadeGirisi", app: "mobile", modul: "cekirdek:sevkiyat-depo", title: "İade Girişi", requires: ["mobile:iade"], capabilities: [] },
  { key: "HizliIsEmri", app: "mobile", modul: "productionEnabled", title: `Hızlı ${TERIM.terbiyeIsEmri.tekil}`, requires: ["mobile:hizli-is-emri"], capabilities: [{ code: "mobile:kumas", label: "Kumaş tanımı ekleyebilir" }, { code: "mobile:is-emri-duzelt", label: "Açılmış terbiye iş emrini düzeltebilir (renk · en · sipariş bağı · kartı yeniden bas)" }] },
  { key: "Siparis", app: "mobile", modul: "cekirdek:siparis-musteri", title: "Sipariş", requires: ["mobile:siparis"], capabilities: [] },
  { key: "Kumas", app: "mobile", modul: "cekirdek:ana-veri", title: "Kumaş Ekle", requires: ["mobile:kumas"], capabilities: [] },
  { key: "KursunDagitim", app: "mobile", modul: "productionEnabled", title: TERIM_AD.kursunDagitim, requires: ["mobile:kursun-dagitim"], capabilities: [] },
  // Tablet TEZGAH ekranı (2026-09-14, dokuma dilimi): top indirme + geri alma; koşum/duruş sonraki dilim.
  { key: "Dokuma", app: "mobile", modul: "dokumaEnabled", title: TERIM_AD.tezgahEkrani, requires: ["mobile:dokuma"], capabilities: [{ code: "mobile:dokuma-geri-al", label: "Top indirmeyi, koşumu ve duruşu geri alabilir" }] },
  // Tablet LEVENT SARIM ekranı (2026-09-14, DEVERE-LEVENT-TARAMASI §11): plan · sar · taslak sil; iptal yetenek.
  { key: "Devere", app: "mobile", modul: "devereEnabled", title: "Levent Sarım", requires: ["mobile:devere"], capabilities: [{ code: "mobile:devere-iptal", label: "Sarımı iptal edebilir (iplik defterine ters satır)" }] },
  // Tezgah alarmı A3: usta/amir telefonu + tablet — aktif alarmlar, üstlen/sustur/not, alarm sayfası, yerel bildirim.
  { key: "Uyarilar", app: "mobile", modul: "tezgahEnabled", title: TERIM_AD.tezgahAlarmlari, requires: ["mobile:tezgah-uyari"], capabilities: [] },
  // G2t (2026-09-14): fason dokuma kabulü — aynı izin ikinci ekranda (levent dönüşü + top kabulü; sevk/iptal panelden).
  { key: "FasonDokuma", app: "mobile", modul: "dokumaEnabled", title: "Fason Dokuma Kabul", requires: ["mobile:fason-kabul"], capabilities: [] },
  // K4P-EKRAN (2026-10-25): istasyondan bağımsız Muayene — top okut, 4 puan muayene yaz (oturumsuz).
  { key: "Muayene", app: "mobile", modul: "kaliteGuvenceEnabled", title: "Muayene", requires: ["mobile:muayene"], capabilities: [] },
  // Gülkesim D7 (2026-10-29): tablet "Belge Tara" — foto + barkod + sahip → DRAFT; onay panelde (SoD). Mevcut web izni, yeni kod yok.
  { key: "GelenBelge", app: "mobile", modul: "gelenBelgeEnabled", title: "Belge Tara", requires: ["gelen-belge:write"], capabilities: [] },
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
      "Kumaş teknik kartı = Ürünler ekranının İÇİNDEKİ alanlar (en · gramaj · " +
      "kompozisyon); ayrı bir ekranı yok. Yüzey Dilim 3'te doğacak.",
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
  { code: "web:access", reason: "Giriş kanalı izni (bulut web paneli) — ekran açmaz, çerezli web girişinin kapısıdır (BULUT-WEB-PANELI.md K4)." },
  // Dokuma P2b (2026-09-13): koşum yazma yüzeyi backend'de doğdu, ekranı tablet
  // TEZGAH ekranıdır (DOKUMA-IS-EMRI §3.2) ve henüz yok. Ekran doğduğu gün bu iki
  // satır ölü muaf olur ve bekçi kırmızı verir — silinmesi o dilimin işidir.
  // Koşumun tablet yüzeyi DOĞDU (2026-09-14): tablet `mobile:dokuma` / `mobile:dokuma-geri-al` ile
  // çağırır; `loom:*` web kodları panelsiz kalır (panel koşum yüzeyi yok, kod API/entegrasyon için).
  // Dokuma P3b (2026-09-13): doff yazma yüzeyi backend'de doğdu; ekranı tablet tezgah
  // ekranının "İndir" eylemi (DOKUMA-IS-EMRI §3.4) ve henüz yok — ekranla ölü muaf olur.
  // Doff'un tablet yüzeyi DOĞDU (2026-09-14): tablet `mobile:dokuma` / `mobile:dokuma-geri-al` ile
  // çağırır; `loom:*` web kodları panelsiz kalır — panel doff yüzeyi yok, kod API/entegrasyon için.
  { code: "loom:doff", reason: "Panel doff yüzeyi yok; tablet `mobile:dokuma` ile kaydeder — web kodu API/entegrasyon için." },
  { code: "loom:doff-revoke", reason: "Panel geri alma yüzeyi yok; tablet `mobile:dokuma-geri-al` ile — web kodu API/entegrasyon için." },
  // D4-A1 (2026-10-29): uç backend'de doğdu; tablet "Duruş" çipi (Kurşun + Tambur ekranı) D4-A2 dilimiyle
  // gelir — o gün bu satır ölü muaf olur ve çip ekranının yeteneğine taşınır.
  { code: "mobile:makine-durus", reason: "Tablet duruş çipi D4-A2 dilimiyle doğar; uç (`/api/machine-stops`) bugünden hazır." },
  // Tezgah künyesi + gölge mod (B3, 2026-09-14): "Devreye Alma" ekranı AYRI dilim (Faz 2 ingest ile, `tezgah.enabled`).
];

/** Katalogda adı geçmeyen izin var mı? (bekçi ve panel bandı kullanır) */
export function permissionsWithoutScreen(): string[] {
  const used = screenCatalogCodes();
  const exempt = new Set(SCREENLESS_PERMISSIONS.map((e) => e.code));
  return PERMISSION_CATALOG.map((p) => p.code).filter((c) => !used.has(c) && !exempt.has(c));
}

/**
 * MOBİL KARO İZİNLERİ — her tablet ekranının (karo) `requires` kümesi, YETENEK izinleri (`capabilities`: geri alma,
 * düzeltme, ana veri) HARİÇ. "Saha operatörü" rol şablonunun tek kaynağı (`role-template-catalog` SAHA_OPERATORU):
 * yeni karo katalogda doğunca şablon kendiliğinden genişler, elle sayılmaz; yetenek izni sızmaz (bekçi ölçer).
 */
export function mobileScreenPermissionCodes(): string[] {
  const out = new Set<string>();
  for (const e of SCREEN_CATALOG) if (e.app === "mobile") for (const c of e.requires) out.add(c);
  return [...out].sort();
}
