// =============================================================================
// TeksERP — İZİN KATALOĞU (TEK KAYNAK)
// =============================================================================
// Bu dosya, sistemdeki TÜM permission kodlarının **tek kaynağıdır**. Aynı listeyi
// okuyan iki tüketici vardır:
//
//   1. `prisma/seed.ts`      — taze/boş kurulumda katalogu ilk kez yazar.
//   2. Boot-time uzlaştırma  — backend her açılışta DB'de EKSİK olan satırları
//                              yazar (mevcut fabrikalar için). Kodu deploy etmek
//                              = katalogu getirmek; unutulacak bir adım kalmaz.
//
// NEDEN TEK KAYNAK:
//   `requirePermission("x:y")` yazıldığı anda o satırın DB'de olması bir
//   ZORUNLULUK olur — yoksa Admin dışı HERKES 403 alır ve sebebi ekranda
//   anlaşılmaz. `prisma/seed.ts` YALNIZ ilk kurulumda koştuğu için mevcut bir
//   fabrikada yeni izin satırları hiç doğmuyordu. 2026-08-01'de bu fiilen
//   yaşandı: kurşun bypass ekranı canlıya çıktı, izin satırı olmadığı için
//   kimse göremedi, teşhis saatler aldı.
//
// YENİ İZİN EKLERKEN:
//   • YALNIZ bu dosyaya yaz. seed.ts'e ya da başka bir listeye kopyalama —
//     kopyalanan liste er ya da geç ayrışır.
//   • `category` alanı Prisma `PermissionCategory` enum'udur (web|mobile|admin);
//     tipi gevşetme — yazım hatası derlemede düşsün.
//   • Kullanıcı→izin ATAMALARI buraya GİRMEZ. Katalog ortamdan bağımsızdır,
//     atama fabrikaya özgüdür (panelden ya da `scripts/sync-*-permissions.ts`
//     deseniyle verilir). Kural: *katalog koda, atama script'e.*
//   • Burada bir kod SİLMEK, uzlaştırmanın onu DB'den kaldıracağı anlamına
//     GELMEZ — uzlaştırma yalnız ekler (mevcut atamaları koparmamak için).
//     Gerçekten kaldırılacaksa ayrıca bir veri migration'ı gerekir.
// =============================================================================

import { PermissionCategory } from "@prisma/client";

/** Katalogdaki tek bir izin satırı. `Permission` modelinin katalog alanları. */
export type PermissionCatalogEntry = {
  /** `requirePermission()` içinde geçen kod — DB'de `@unique`. */
  readonly code: string;
  /** Gruplama etiketi (SALES, PRODUCTION, MOBILE ...). */
  readonly module: string;
  /** Prisma enum — web | mobile | admin. */
  readonly category: PermissionCategory;
  /** Yetki ekranında görünen Türkçe açıklama. */
  readonly description?: string;
};

export const PERMISSION_CATALOG = [
  // ----- WEB / API endpoint izinleri -----
  { code: "order:read", module: "SALES", category: "web", description: "Sipariş listesi/detay görüntüleme" },
  { code: "order:write", module: "SALES", category: "web", description: "Sipariş oluşturma/düzenleme/iptal" },
  { code: "customer:read", module: "SALES", category: "web", description: "Müşteri listesi/detay görüntüleme" },
  { code: "customer:write", module: "SALES", category: "web", description: "Müşteri oluşturma/düzenleme" },
  { code: "workorder:read", module: "PRODUCTION", category: "web", description: "İş emri listesi/detay görüntüleme" },
  { code: "workorder:write", module: "PRODUCTION", category: "web", description: "İş emri oluşturma/düzenleme/finalize etme" },
  { code: "roll:read", module: "PRODUCTION", category: "web", description: "Top (rulo) listesi/detay görüntüleme" },
  { code: "roll:write", module: "PRODUCTION", category: "web", description: "Top oluşturma/durum güncelleme" },
  { code: "roll:manual-adjust", module: "PRODUCTION", category: "web", description: "Süpervizör — manuel top düzeltme/kurtarma (üretime geri al, nitelik/durum düzeltme)" },
  // 2026-08-05: topun TAM YAŞAM DÖNGÜSÜ zaman çizelgesi (kim ekledi, hangi
  // istasyonda ne zaman durdu, fasona gitti/döndü, kesildi, depoya indi).
  // `roll:read`ten AYRI bir izin olması ürün kararıdır: liste/detay herkesin
  // günlük işi, izlenebilirlik geçmişi ise denetim verisidir ve operatör
  // ekranını gereksiz yere derinleştirir. İzin YOKSA Electron o bölümü HİÇ
  // ÇİZMEZ — boş bir kutu göstermek "veri yok" yalanı olurdu.
  { code: "roll:history", module: "PRODUCTION", category: "web", description: "Top yaşam döngüsü (işlem geçmişi) zaman çizelgesi — izlenebilirlik" },
  { code: "workorder:distribute", module: "PRODUCTION", category: "web", description: "Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama" },
  { code: "station:read", module: "PRODUCTION", category: "web", description: "Üretim istasyonu listesi/detay görüntüleme" },
  { code: "station:write", module: "PRODUCTION", category: "web", description: "Üretim istasyonu tanımlama/düzenleme" },
  { code: "item:read", module: "MASTER_DATA", category: "web", description: "Ürün/kumaş tanımı listesi/detay görüntüleme" },
  { code: "item:write", module: "MASTER_DATA", category: "web", description: "Ürün/kumaş tanımı oluşturma/düzenleme" },
  { code: "quality:read", module: "QUALITY", category: "web", description: "Kalite derecesi tanımlarını görüntüleme" },
  { code: "quality:write", module: "QUALITY", category: "web", description: "Kalite derecesi tanımlama/düzenleme" },
  { code: "property:read", module: "QUALITY", category: "web", description: "Özellik (renk/desen vb.) tanımlarını görüntüleme" },
  { code: "property:write", module: "QUALITY", category: "web", description: "Özellik tanımlama/düzenleme" },
  { code: "subcontractor:read", module: "SUBCONTRACTOR", category: "web", description: "Fason firma listesi/detay görüntüleme" },
  { code: "subcontractor:write", module: "SUBCONTRACTOR", category: "web", description: "Fason firma oluşturma/düzenleme" },
  { code: "kartela:read", module: "KARTELA", category: "web", description: "Kartela sevk/kabul takibi" },
  { code: "kartela:write", module: "KARTELA", category: "web", description: "Kartela sevk/kabul + iptal" },
  { code: "customer-alias:read", module: "SALES", category: "web", description: "Müşteriye özel renk/isim eşlemesini görüntüleme" },
  { code: "customer-alias:write", module: "SALES", category: "web", description: "Müşteriye özel renk/isim eşlemesi tanımlama" },
  { code: "label:read", module: "LOGISTICS", category: "web", description: "Etiket payload'unu görüntüleme" },
  { code: "label:print", module: "LOGISTICS", category: "web", description: "Etiket basma aksiyonu" },
  { code: "label:edit", module: "LOGISTICS", category: "web", description: "Sipariş satırı bazlı müşteri ismi/renk override" },
  { code: "label-template:read", module: "LOGISTICS", category: "web", description: "Etiket şablonu listele" },
  { code: "label-template:write", module: "LOGISTICS", category: "web", description: "Etiket şablonu oluşturma/düzenleme/silme" },
  { code: "shipping:read", module: "LOGISTICS", category: "web", description: "Sevkiyat/çuval listesi/detay görüntüleme" },
  { code: "shipping:write", module: "LOGISTICS", category: "web", description: "Çuval/irsaliye oluşturma, tartı/kapama, sevk" },
  { code: "shipping:invoice", module: "LOGISTICS", category: "web", description: "Sevkiyatı faturalandı olarak işaretleme (muhasebe)" },
  // Sevk geri alma (storno) — `shipping:write`ten AYRI: sevk eden herkesin resmi
  // çıkış belgesini iptal edip stok/karşılanma defterini geri sarabilmesi istenmiyor.
  { code: "shipping:undo-dispatch", module: "LOGISTICS", category: "web", description: "Sevk edilmiş sevkiyatı geri alma (irsaliye iptal + stok depoya)" },
  { code: "return:read", module: "LOGISTICS", category: "web", description: "İade takibi raporu görüntüleme" },
  { code: "return:write", module: "LOGISTICS", category: "web", description: "İade alma + iade nedeni kataloğu oluşturma/düzenleme/silme" },
  { code: "admin:users", module: "ADMIN", category: "admin", description: "Kullanıcı + yetki yönetimi" },
  { code: "admin:settings", module: "ADMIN", category: "admin", description: "Sistem ayarları + log arşiv" },
  // 2026-08-05: "Bu Bilgisayar" (yerel donanım) ayarları — etiket yazıcısı,
  // kantar, barkod tabancası, sunucu adresi. `admin:settings`ten AYRI olması
  // ürün kararıdır: bu ayarların HİÇBİRİ sunucuya yazılmaz, yalnız o makinenin
  // yerel deposunda (electron-store) yaşar → yanlış girilse bile etkisi tek
  // bilgisayarla sınırlıdır. Yazıcısını kendisi kuran depo/sevkiyat personeline
  // sistem geneli özellik anahtarlarını, oturum politikasını, cihaz onayını ve
  // log arşivini açmak zorunda kalmamak için var.
  // Kategorisi `admin` DEĞİL `web` — çünkü bir YÖNETİM yetkisi değil, masaüstü
  // uygulamasının bir yeteneği (Electron `hasAdminAccess` bu kodu saymaz →
  // taşıyan kişi "Yönetim" menüsünü ve Sistem hub'ını GÖRMEZ).
  { code: "settings:workstation", module: "ADMIN", category: "web", description: "Bu bilgisayarın yerel ayarları (etiket yazıcısı / kantar / tabanca / sunucu adresi) — sistem geneli ayarlar HARİÇ" },
  // 2026-08-05: Tanımlar → Çıktılar altındaki belge/kart TASARIM ekranları
  // (Belge Şablonları, Refakat Kartı, Refakat Kartı Şablonları, Serbest
  // Belgeler). `admin:settings`ten AYRI olması ürün kararıdır — `settings:
  // workstation` ile aynı gerekçe: bu dört ekran baskı ÇIKTISININ görünümünü
  // belirler, sistem yönetimiyle (oturum politikası, yedek saati, cihaz onayı,
  // log arşivi) hiçbir ilgisi yoktur. Şablonu düzenleyen büro personeli çoğu
  // kurulumda sistem yöneticisi DEĞİLDİR.
  // Kategorisi `admin` DEĞİL `web`: Electron `hasAdminAccess` bu kodları
  // saymaz → taşıyan kişi "Yönetim" menüsünü ve Sistem hub'ını GÖRMEZ.
  // ⚠️ `admin:settings` bu ekranları AÇMAYA DEVAM EDER (guard'lar OR) —
  // uzlaştırma izni DB'ye getirir ama kimseye ATAMAZ; sıkı ayrım deploy
  // anında admin dahil herkesi dışarıda bırakırdı. Küme: constants/document-design.ts
  { code: "document-template:read", module: "ADMIN", category: "web", description: "Belge şablonları / refakat kartı ayarı / serbest belgeleri görüntüleme (salt-okunur)" },
  { code: "document-template:write", module: "ADMIN", category: "web", description: "Belge şablonu + refakat kartı ayarı/şablonu + serbest belge oluşturma/düzenleme/silme" },
  { code: "admin:*", module: "ADMIN", category: "admin", description: "Tüm admin yetkileri (wildcard)" },
  { code: "report:production", module: "REPORTS", category: "web", description: "Üretim raporları" },
  { code: "report:sales", module: "REPORTS", category: "web", description: "Sipariş raporları" },
  { code: "report:quality", module: "REPORTS", category: "web", description: "Kalite raporları" },
  { code: "report:inventory", module: "REPORTS", category: "web", description: "Stok & depo raporları" },
  { code: "report:subcontract", module: "REPORTS", category: "web", description: "Fason raporları" },
  { code: "report:customer", module: "REPORTS", category: "web", description: "Müşteri / satış profil raporları" },
  { code: "report:audit", module: "REPORTS", category: "web", description: "Sistem / audit raporları" },

  // ----- MOBİL EKRAN izinleri -----
  // Route'larda `requireAnyPermission("web:perm", "mobile:xxx")` ile web
  // yetkilerine alternatif kabul edilir.
  { code: "mobile:kk1", module: "MOBILE", category: "mobile", description: "KK1 ham giriş ekranı" },
  { code: "mobile:kk2-kursun", module: "MOBILE", category: "mobile", description: "Kurşun + KK2 ekranı" },
  { code: "mobile:tambur", module: "MOBILE", category: "mobile", description: "Tambur karar ekranı" },
  { code: "mobile:depo", module: "MOBILE", category: "mobile", description: "Depo ekranı" },
  { code: "mobile:fason-sevk", module: "MOBILE", category: "mobile", description: "Fason sevk ekranı" },
  { code: "mobile:fason-kabul", module: "MOBILE", category: "mobile", description: "Fason mal kabul ekranı" },
  { code: "mobile:kartela-sevk", module: "MOBILE", category: "mobile", description: "Kartela sevk ekranı" },
  { code: "mobile:kartela-kabul", module: "MOBILE", category: "mobile", description: "Kartela mal kabul ekranı" },
  { code: "mobile:tarti-paket", module: "MOBILE", category: "mobile", description: "Tartı & Paketleme ekranı" },
  { code: "mobile:sevkiyat", module: "MOBILE", category: "mobile", description: "Sevkiyat yönetimi ekranı" },
  { code: "mobile:iade", module: "MOBILE", category: "mobile", description: "İade girişi ekranı" },
  { code: "mobile:hizli-is-emri", module: "MOBILE", category: "mobile", description: "Hızlı İş Emri ekranı (stok topu okut → iş emri başlat + iş emri yönetimi)" },
  // Telefondan sipariş LİSTELEME + AÇMA (satış/planlama). `order:read` +
  // `order:write`'ın DAR mobil ikizi: yalnız okuma ve yaratma. Düzenleme /
  // iptal / manuel-kapatma / silme uçları hâlâ `order:write` ister — satış
  // temsilcisine sipariş sildirmemek için (bekçi: test_mobile_order_permission).
  { code: "mobile:siparis", module: "MOBILE", category: "mobile", description: "Mobil — Sipariş ekranı (sipariş listesi + yeni sipariş açma)" },
  // Telefondan KUMAŞ TANIMI ekleme (Electron'daki ürün formunun mobil ikizi).
  // `item:write`ten AYRI, ürün kararı: master-data yazma yetkisi web'de ürün
  // DÜZENLEME/pasifleştirmeyi de açar; mobil ekran yalnız YENİ tanım ekler.
  // KK1-içi `mobile:kk1-desen` ile de karıştırılmamalı — o, yalnız ad alan ve
  // `pendingReview=true` işaretleyen hızlı desen açma yeteneğidir.
  { code: "mobile:kumas", module: "MOBILE", category: "mobile", description: "Mobil — Kumaş (ürün) tanımı ekleme ekranı" },
  { code: "mobile:kursun-dagitim", module: "MOBILE", category: "mobile", description: "Mobil — Kurşun Dağıtım ekranı" },
  // Ekran değil, KK1 içi yetenek: yalnız seçili ham giriş operatörlerine verilir.
  { code: "mobile:kk1-desen", module: "MOBILE", category: "mobile", description: "KK1 ham girişte inline yeni desen (FABRIC kumaş) oluşturma" },
  // Ekran değil, Tambur içi yetenek: envanter zincirinde DELİK açar (elle top
  // yaratma) → varsayılan operatör paketine GİRMEZ, panelden seçili kişiye verilir.
  // Bu yüzden hiçbir PermissionTemplate'e de eklenmedi (katalog koda, atama panele).
  { code: "mobile:tambur-duzelt", module: "MOBILE", category: "mobile", description: "Tambur — saha düzeltmesi (mevcut topu Tambur'a al + manuel top ekle)" },
  { code: "mobile:*", module: "MOBILE", category: "mobile", description: "Tüm mobil ekranlar (wildcard)" },
] as const satisfies readonly PermissionCatalogEntry[];
