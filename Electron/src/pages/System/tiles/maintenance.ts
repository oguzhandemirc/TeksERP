// Sistem › Bakım karoları (sıra = hub sırası).
import { ScrollText, DatabaseBackup, DatabaseZap, DatabaseSearch, Download, Info, KeyRound, LifeBuoy, Upload, Merge } from "lucide-react";
import { LICENSE_ACCESS, SYSTEM_BACKUPS_ACCESS } from "@/lib/permissions";
import type { SystemTile } from "../tile-config";

export const maintenanceTiles: SystemTile[] = [
  {
    key: "data-import",
    title: "Veri Aktarımı",
    description: "Excel/CSV ile toplu kayıt yükleme + aktarım geçmişi",
    icon: Upload,
    to: "/system/data-import",
    group: "maintenance",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    permission: "data:import",
  },
  {
    key: "duplicates",
    title: "Mükerrer Kayıtlar",
    description: "Aynı kaydın iki kez açılmış hâllerini tek kayda birleştir",
    icon: Merge,
    to: "/system/duplicates",
    group: "maintenance",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    // Yerleşim: araç DÖRT tanım ekranını birden keser (müşteri/kumaş/renk/fason);
    // birinin içine koymak diğer üçünden gizlerdi — Veri Aktarımı ile aynı şekil.
    permission: "master-data:merge",
  },
  {
    key: "backups",
    title: "Yedekler",
    description: "Veritabanı yedeklerini listele, indir, geri yükleme komutunu kopyala",
    icon: DatabaseBackup,
    to: "/system/backups",
    group: "maintenance",
    permissionAny: SYSTEM_BACKUPS_ACCESS,
  },
  {
    key: "db-restore",
    title: "Veritabanı Geri Yükleme",
    description: "Yedeği yeni bir veritabanına geri yükle, doğrula, geçiş yap (canlıya dokunmaz)",
    icon: DatabaseZap,
    to: "/system/db-restore",
    group: "maintenance",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    // G5 — müşterinin BI aracı için yalnız-okuma DB girişi; backend YALNIZ sistem hesabına açar (supapsız 403).
    key: "read-only-db",
    title: "Veritabanı Okuma Erişimi",
    description: "Raporlama aracınız için yalnız-okuma veritabanı kullanıcısı — bağlantı bilgisi, parola yenile",
    icon: DatabaseSearch,
    to: "/system/read-only-db",
    group: "maintenance",
    permission: "admin:settings",
    superadminOnly: true,
  },
  {
    // Sunucu + bu bilgisayar güncellemesi TEK sayfada (2026-10-12; eski "Güncelleme" ve "Sunucu Güncellemeleri"
    // karoları burada birleşti). KAPISIZ: herkes açar, onay düğmeleri sayfa içinde `license:manage`e.
    key: "updates",
    title: "Güncellemeler",
    description: "Sunucu ve bu bilgisayar: kurulu sürüm, yeni sürüm, onay",
    icon: Download,
    to: "/system/updates",
    group: "maintenance",
    public: true,
  },
  {
    key: "license",
    title: "Lisans",
    description: "Lisans durumu, hak ve modüller, kira ve yoklama, etkinleştirme ve taşıma",
    icon: KeyRound,
    to: "/system/license",
    group: "maintenance",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI küme.
    permissionAny: LICENSE_ACCESS,
    licenseObservationGate: true,
  },
  {
    key: "support",
    title: "Destek",
    description: "Satıcıya destek talebi açın (ekran görüntüsü + sağlık özeti), yanıtları izleyin",
    icon: LifeBuoy,
    to: "/system/support",
    group: "maintenance",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    permission: "support:create",
  },
  {
    key: "about",
    title: "Hakkında",
    description: "Lisans sahibi, lisans numarası ve program sürümleri",
    icon: Info,
    to: "/system/about",
    group: "maintenance",
    // ⚠️ content-routes.tsx'teki ProtectedRoute ile AYNI kod.
    permission: "license:view",
  },
  {
    key: "release-notes",
    title: "Sürüm Notları",
    description: "Geçmiş güncellemelerde neler değişti — sürüm sürüm, aranabilir",
    icon: ScrollText,
    to: "/release-notes",
    group: "maintenance",
    public: true,
  },
];
