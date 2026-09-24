import { Activity, Archive, ScrollText, Hash, Blocks, Cpu, DatabaseBackup, DatabaseZap, Download, FileCode2, Gauge, MapPin, Search, Building2, Monitor, Printer, SlidersHorizontal, Upload, type LucideIcon, Merge, MonitorSmartphone } from "lucide-react";
import {
  SETTINGS_COMPANY_ACCESS,
  SETTINGS_FLAGS_ACCESS,
  SETTINGS_PRINTING_ACCESS,
  SETTINGS_WORKSTATION_ACCESS,
  SYSTEM_ACTIVITY_ACCESS,
  SYSTEM_BACKUPS_ACCESS,
  SYSTEM_CLIENTS_ACCESS,
  SYSTEM_ROLL_ARCHIVE_ACCESS,
  SYSTEM_SERVER_STATUS_ACCESS,
  SYSTEM_WORK_SESSIONS_ACCESS,
} from "@/lib/permissions";

export type SystemTileGroup = "activity" | "monitoring" | "archive" | "config";

export interface SystemTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  group: SystemTileGroup;
  adminOnly?: boolean;
  /**
   * Kapısız karo — hub'ı açabilen herkes görür, route da `ProtectedRoute`
   * taşımaz (`tile-route-permission.test` bunu ölçer). Palete ayrıca konmaz:
   * kapısız hedefin palet girişi kendi bölümünde yaşar.
   */
  public?: boolean;
  /**
   * Karo/palet görünürlüğü için gereken izin — route guard'ıyla AYNI kod olmalı.
   * Ayrışırsa kullanıcı kartı görür, tıklar, /forbidden'a düşer ("Kurşun Sırası"
   * dersi). Verilmezse karo `admin:settings` sayılır (Sistem hub'ının varsayılanı).
   */
  permission?: string;
  /**
   * `permission`ın çoklu hâli: bunlardan HERHANGİ biri yeterli. Route
   * `requireAnyPermission` ile eşleşir (`tile-route-permission.test` çok izinli
   * route'u "ANY" sayıp tek-izin karşılaştırmasını atlar; hizayı o dosyadaki
   * adı geçen ayrı kural ölçer).
   *
   * ⚠️ `permission` ile BİRLİKTE VERİLMEZ — iki kapıdan hangisinin geçerli
   * olduğu okuyucuya kalırdı.
   */
  permissionAny?: string[];
  /**
   * Karo YALNIZ satıcı (süperadmin) hesabına çizilir — ÜÇÜNCÜ kapı.
   *
   * ⚠️ İZNİN YERİNE GEÇMEZ, ÜSTÜNE EKLENİR: karo `permission`ını taşımaya devam
   * eder ve route ile birebir kalır (`tile-route-permission.test`). İzni bırakıp
   * yalnız kimliğe dayanmak o bekçinin kapsamını daraltırdı.
   *
   * ⚠️ 2026-09-04'ten beri ROUTE DA aynı kapıyı taşır (`requireSystemAccount`)
   * ve yüklem SUPAPLIDIR: modül anahtarlarının Genel Ayarlar'daki ikinci yazma
   * yolu kaldırıldı, yani supapsız bir kapı süperadminsiz kurulumu modülsüz
   * bırakırdı. Yüklem tek kaynaktan gelir (`lib/superadmin-gate.ts`) — supap
   * (`!systemAccountExists`) tüketicilerin birinde unutulursa o kurulum
   * modüllerini bir daha yapılandıramaz.
   */
  superadminOnly?: boolean;
}

export interface SystemTileSection {
  group: SystemTileGroup;
  title: string;
  description: string;
}

export const systemTileSections: SystemTileSection[] = [
  {
    group: "activity",
    title: "Aktivite & Denetim",
    description: "Sistemde ne olduğunu izlemek için canlı log görünümleri",
  },
  {
    group: "monitoring",
    title: "İzleme & Sağlık",
    description: "Sunucu kaynakları ve uç-nokta performansı — sistem sağlığı",
  },
  {
    group: "archive",
    title: "Arşiv",
    description: "Eski log'ları arşive taşı veya geçmiş kayıtları ara",
  },
  {
    group: "config",
    title: "Yapılandırma",
    description: "Sistem geneli ayarlar",
  },
];

export const systemTiles: SystemTile[] = [
  {
    key: "data-import",
    title: "Veri Aktarımı",
    description: "Excel/CSV ile toplu kayıt yükleme + aktarım geçmişi",
    icon: Upload,
    to: "/system/data-import",
    group: "config",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    permission: "data:import",
  },
  {
    key: "duplicates",
    title: "Mükerrer Kayıtlar",
    description: "Aynı kaydın iki kez açılmış hâllerini tek kayda birleştir",
    icon: Merge,
    to: "/system/duplicates",
    group: "config",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    // Yerleşim: araç DÖRT tanım ekranını birden keser (müşteri/kumaş/renk/fason);
    // birinin içine koymak diğer üçünden gizlerdi — Veri Aktarımı ile aynı şekil.
    permission: "master-data:merge",
  },
  {
    key: "activity",
    title: "Aktivite Günlüğü",
    description: "Son aylarda kim hangi kaydı değiştirdi (aktif tablo)",
    icon: Activity,
    to: "/system/activity",
    group: "activity",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
  {
    key: "logs",
    title: "Sistem Kayıtları",
    description: "Kimlik doğrulama ve sistem olayları (login, başlatma, hata)",
    icon: FileCode2,
    to: "/system/logs",
    group: "activity",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
  {
    key: "work-sessions",
    title: "Çalışma Oturumları",
    description: "Kim hangi makinede — canlı görünüm + geçmiş (saha ayak izi)",
    icon: MapPin,
    to: "/system/work-sessions",
    group: "activity",
    permissionAny: SYSTEM_WORK_SESSIONS_ACCESS,
  },
  {
    // 2026-08-05: Envanter sekme şeridinden buraya taşındı. Başlık "TOP
    // Arşivi" — komşusu "Aktivite Arşivi" (SystemLog) ve ikisi tamamen farklı
    // şeyler; tek kelimelik "Arşiv" ikisini de karşılar ve yanlış tıklatır.
    key: "roll-archive",
    title: "Top Arşivi",
    description: "Emekli toplar — kesilmiş, fasonda/kartelada tüketilmiş kayıtlar",
    icon: Archive,
    to: "/system/roll-archive",
    group: "archive",
    permissionAny: SYSTEM_ROLL_ARCHIVE_ACCESS,
  },
  {
    key: "archive",
    title: "Aktivite Arşivi",
    description: "Eski log'ları arşive taşı; tablo boyutu istatistikleri",
    icon: Archive,
    to: "/system/archive",
    group: "archive",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    key: "archive-search",
    title: "Arşiv Tarama",
    description: "Aktivite Günlüğü'nün arşivlenmiş eski kayıtlarını ara",
    icon: Search,
    to: "/system/archive/search",
    group: "archive",
    permissionAny: SYSTEM_ACTIVITY_ACCESS,
  },
  {
    key: "perf",
    title: "Endpoint Performansı",
    description: "Hangi uç yavaş — route bazında p50/p95, yavaş istek defteri, günlük trend",
    icon: Gauge,
    to: "/system/perf",
    group: "monitoring",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    key: "server-status",
    title: "Sunucu Durumu",
    description: "Backend CPU/RAM kullanımı, çalışma süresi ve makine kaynakları",
    icon: Cpu,
    to: "/system/server-status",
    group: "monitoring",
    permissionAny: SYSTEM_SERVER_STATUS_ACCESS,
  },
  {
    // Bağlı İstemciler — "hangi panel/tablet hangi sürümde, en son ne zaman
    // görüldü, kim oturumdaydı". İzin: `admin:settings` (hub'ın varsayılanı;
    // yeni izin kodu AÇILMADI — sahada atanması unutulacak bir adım daha
    // olurdu, 2026-08-01 kurşun bypass dersi).
    key: "clients",
    title: "Bağlı İstemciler",
    description: "Panel/tablet sürümleri, son görülme zamanı ve son kullanıcı",
    icon: MonitorSmartphone,
    to: "/system/clients",
    group: "monitoring",
    permissionAny: SYSTEM_CLIENTS_ACCESS,
  },
  {
    key: "backups",
    title: "Yedekler",
    description: "Veritabanı yedeklerini listele, indir, geri yükleme komutunu kopyala",
    icon: DatabaseBackup,
    to: "/system/backups",
    group: "config",
    permissionAny: SYSTEM_BACKUPS_ACCESS,
  },
  {
    key: "db-restore",
    title: "Veritabanı Geri Yükleme",
    description: "Yedeği yeni bir veritabanına geri yükle, doğrula, geçiş yap (canlıya dokunmaz)",
    icon: DatabaseZap,
    to: "/system/db-restore",
    group: "config",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    // SATICI EKRANI — modül anahtarlarının TEK evi (2026-09-04). Eskiden aynı
    // anahtarlar Genel Ayarlar → Modüller sekmesinde de yazılabiliyordu; o
    // sekme kullanıcı isteğiyle kaldırıldı ("modül flaglarını ayrı bir yere
    // taşıyalım"). Sayfa ayrıca kurulum fotoğrafıdır: profil karşılaştırması ·
    // bağımlılık okları · "kapatırsan gizlenir" önizlemesi · tutarsızlık
    // bantları · kurulum beyanı (demo) · ayar şifresi.
    //
    // ⚠️ ROUTE PATH DEĞİŞMEDİ (`/system/module-profile`): derin bağlantılar,
    // sekme başlıkları ve satıcının telefonda tarif ettiği adres yaşıyor.
    // Değişen şey BAŞLIK ("Sistem Profili" → "Modüller", kullanıcının kendi
    // kelimesi).
    key: "module-profile",
    title: "Modüller",
    description: "Bu kurulumda hangi modüller açık — profil uygula, bağımlılıkları ve kapatma etkisini gör",
    icon: Blocks,
    to: "/system/module-profile",
    group: "config",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    // FABRİKANIN kendi tercihleri — modül anahtarlarından AYRI ekran
    // (2026-09-04): "firmadaki yetkilinin düzenleyebileceği flaglar ayrı bir
    // yerde olsun". Aynı kabuk, farklı yüzey (`SettingsSurface`).
    key: "numbering",
    title: "Numaralandırma",
    description: "Sevkiyat · çuval · sevk partisi · iade belge numaralarının ön eki ve biçimi",
    icon: Hash,
    to: "/system/numbering",
    group: "config",
    permission: "settings:numbering",
  },
  {
    key: "feature-flags",
    title: "Özellik Anahtarları",
    description: "Sipariş/sevkiyat, üretim, kalite ve muhasebe davranışını belirleyen ayarlar",
    icon: SlidersHorizontal,
    to: "/system/feature-flags",
    group: "config",
    permissionAny: SETTINGS_FLAGS_ACCESS,
  },
  {
    // Eskiden Genel Ayarlar → Bu Bilgisayar → Güncelleme alt-sekmesiydi.
    // ⚠️ İZİN GENİŞ ve bu bilinçli: yazıcısını/kantarını kendisi kuran personel
    // `settings:workstation` taşır ve `admin:settings` taşımaz — güncelleme
    // durumuna bakması gereken kişi çoğu zaman odur. Hub'ın kendisi
    // `admin:settings` arkasında olduğu için o personel buraya PALETTEN gelir.
    //
    // ⚠️ WEB'DE DE ÇİZİLİR ve bu bilinçli: sayfa tarayıcıda kendi "yalnız
    // masaüstünde çalışır" metnini basıyor, yani başlığın gövdesi VAR. Karoyu
    // kabuğa göre gizlemek "her statik route'un bir palet girişi var"
    // invariantını da (`command-entries.test`) muafiyet listesine zorlardı.
    // Emsal: yazıcı/kantar/tabanca sekmeleri de web'de duruyor.
    key: "update",
    title: "Güncelleme",
    description: "Bu bilgisayardaki sürüm, güncelleme durumu ve yayın adresi",
    icon: Download,
    to: "/system/update",
    group: "config",
    permissionAny: ["admin:settings", "settings:workstation"],
  },
  {
    key: "release-notes",
    title: "Sürüm Notları",
    description: "Geçmiş güncellemelerde neler değişti — sürüm sürüm, aranabilir",
    icon: ScrollText,
    to: "/release-notes",
    group: "config",
    public: true,
  },
  {
    key: "printing",
    title: "Baskı & Cihazlar",
    description: "Etiket baskısı (kopya, ortam, gönderim) ve tablet eşleştirme zorunluluğu",
    icon: Printer,
    to: "/system/printing",
    group: "config",
    permissionAny: SETTINGS_PRINTING_ACCESS,
  },
  {
    key: "workstation",
    title: "Bu Bilgisayar",
    description: "Bu bilgisayara bağlı yazıcı, kantar, barkod tabancası ve sunucu adresi",
    icon: Monitor,
    to: "/system/workstation",
    group: "config",
    permissionAny: SETTINGS_WORKSTATION_ACCESS,
  },
  {
    key: "company",
    title: "Şirket & Güvenlik",
    description: "Şirket bilgileri (ad, antet, logo) ve oturum & güvenlik politikası",
    icon: Building2,
    to: "/system/company",
    group: "config",
    permissionAny: SETTINGS_COMPANY_ACCESS,
  },
];

