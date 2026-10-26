// Sistem › Ayarlar karoları (sıra = hub sırası).
import { Hash, Blocks, Building2, Monitor, Printer, SlidersHorizontal, BellRing } from "lucide-react";
import { TERIM_AD } from "@/lib/terim";
import { SETTINGS_COMPANY_ACCESS, SETTINGS_FLAGS_ACCESS, SETTINGS_PRINTING_ACCESS, SETTINGS_WORKSTATION_ACCESS, NOTIFICATION_PROFILES_ACCESS } from "@/lib/permissions";
import type { SystemTile } from "../tile-config";

export const settingsTiles: SystemTile[] = [
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
    group: "settings",
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
    group: "settings",
    permission: "settings:numbering",
  },
  {
    key: "feature-flags",
    title: "Özellik Anahtarları",
    description: "Sipariş/sevkiyat, üretim, kalite ve muhasebe davranışını belirleyen ayarlar",
    icon: SlidersHorizontal,
    to: "/system/feature-flags",
    group: "settings",
    permissionAny: SETTINGS_FLAGS_ACCESS,
  },
  {
    key: "printing",
    title: "Baskı & Cihazlar",
    description: "Etiket baskısı (kopya, ortam, gönderim) ve tablet eşleştirme zorunluluğu",
    icon: Printer,
    to: "/system/printing",
    group: "settings",
    permissionAny: SETTINGS_PRINTING_ACCESS,
  },
  {
    key: "workstation",
    title: "Bu Bilgisayar",
    description: "Bu bilgisayara bağlı yazıcı, kantar, barkod tabancası ve sunucu adresi",
    icon: Monitor,
    to: "/system/workstation",
    group: "settings",
    permissionAny: SETTINGS_WORKSTATION_ACCESS,
  },
  {
    key: "company",
    title: "Şirket & Güvenlik",
    description: "Şirket bilgileri (ad, antet, logo) ve oturum & güvenlik politikası",
    icon: Building2,
    to: "/system/company",
    group: "settings",
    permissionAny: SETTINGS_COMPANY_ACCESS,
  },
  {
    // bildirim: yönetici profilleri + fabrika varsayılanı; bayrak kapalıyken karo kalır, "kapalı" notu taşır.
    key: "notification-profiles",
    title: TERIM_AD.bildirimProfilleri,
    description: "Kişilere atanan hazır bildirim tercih setleri ve fabrika varsayılanı",
    icon: BellRing,
    to: "/system/notification-profiles",
    group: "settings",
    permissionAny: NOTIFICATION_PROFILES_ACCESS,
    kapaliBayrak: "bildirimGelenKutusuEnabled",
  },
];
