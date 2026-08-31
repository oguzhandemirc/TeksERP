import { Settings as SettingsIcon, FilePlus2 } from "lucide-react";
import { navGroups } from "./nav-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { definitionGroups } from "@/pages/Definitions/groups-config";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { financeTiles } from "@/pages/Finance/tile-config";
import { accessTiles } from "@/pages/Access/tile-config";
import { systemTiles } from "@/pages/System/tile-config";
import {
  SETTINGS_ADMIN_PERMISSION,
  SETTINGS_CATEGORIES,
} from "@/pages/GeneralSettings/settings-config";
import { settingsCategoryVisibleWhen } from "@/pages/GeneralSettings/settings-groups";
import { reportCommandSections } from "./command-entries.reports";
import { deepCommandSections } from "./command-entries.deep";
import type { CommandEntry, CommandSection } from "./command-entries.types";

export type { CommandEntry, CommandSection } from "./command-entries.types";

/**
 * Komut paletinin (Ctrl+K) kataloğu — uygulamadaki HER ekranın tek listesi.
 *
 * KAYNAK KOPYALANMAZ, TAŞINIR: bölümler hub karo config'lerinden türetilir
 * (her modülün `tile-config.ts`i). Yeni bir ekran karo olarak eklendiği an
 * palette de çıkar; buraya elle satır yazmak, ikisinin ayrışacağı ilk yerdir.
 *
 * İZİN, ROUTE'UN İZNİDİR. `ProtectedRoute` katı davranır (admin kısayolu YOK) →
 * girişe route'un istediğinden farklı bir izin yazmak, kullanıcıya görünen ama
 * tıklayınca `/forbidden`'a düşen bir satır üretir.
 */
export const commandSections: CommandSection[] = [
  ...navGroups.map<CommandSection>((group) => ({
    heading: group.label,
    entries: group.items.map((item) => ({
      key: `nav:${item.to}`,
      label: item.label,
      icon: item.icon,
      to: item.to,
      permission: item.permission,
      adminOnly: item.adminOnly,
    })),
  })),
  {
    heading: "Operasyon",
    entries: [
      ...operationsTiles.map<CommandEntry>((tile) => ({
        key: `ops:${tile.key}`,
        label: tile.title,
        description: tile.description,
        icon: tile.icon,
        to: tile.to,
        permission: tile.permission,
        permissionAny: tile.permissionAny,
        // Karo ile AYNI yüklem nesnesi — palet hub'dan ayrışamaz.
        visibleWhen: tile.visibleWhen,
      })),
      {
        // Karosu yok (hub'da "İş Emirleri"nin içinden açılır) ama en sık
        // yapılan işlerden biri — paletten tek adımda açılabilmeli.
        key: "ops:work-order-new",
        label: "Yeni İş Emri",
        description: "Boş iş emri formunu aç",
        icon: FilePlus2,
        to: "/operations/work-orders/new",
        permission: "workorder:write",
        keywords: "iş emri oluştur ekle yeni üretim aç",
      },
    ],
  },
  {
    // ⚠️ Muhasebe ekranları palette KOŞULSUZ listelenir; görünürlük kapısı
    // izindir (`permissionAny`). Bayrak kapalı bir kurulumda finance izni
    // atanmamış olur, dolayısıyla satırlar da çıkmaz — ve bayrak açılıp izin
    // verilen an kendiliğinden belirirler. Palete ayrıca bayrak yüklemi
    // koymak, hub karolarıyla ayrışabilecek İKİNCİ bir kural demekti.
    heading: "Muhasebe",
    entries: financeTiles.map<CommandEntry>((tile) => ({
      key: `fin:${tile.key}`,
      label: tile.title,
      description: tile.description,
      icon: tile.icon,
      to: tile.to,
      permissionAny: tile.permissionAny,
    })),
  },
  ...reportCommandSections,
  ...definitionGroups.map<CommandSection>((group) => ({
    heading: `Tanımlar · ${group.title}`,
    entries: definitionTiles
      .filter((tile) => tile.group === group.key)
      .map((tile) => ({
        key: `def:${tile.key}`,
        label: tile.title,
        description: tile.description,
        icon: tile.icon,
        to: tile.to,
        permission: tile.permission,
        // permissionAny taşıyan karolar (belge tasarım ekranları) route ile
        // AYNI listeyi kullanır — düşürülürse kart görünür, sayfa açılmaz.
        permissionAny: tile.permissionAny,
        // Rejim yüklemi karodan taşınır (cari rejimi) — palet hub'dan ayrışamaz.
        visibleWhen: tile.visibleWhen,
      })),
  })),
  {
    heading: "Yetkilendirme",
    entries: accessTiles.map((tile) => ({
      key: `access:${tile.key}`,
      label: tile.title,
      description: tile.description,
      icon: tile.icon,
      to: tile.to,
      adminOnly: true,
    })),
  },
  {
    heading: "Sistem",
    entries: systemTiles.map((tile) => ({
      key: `sys:${tile.key}`,
      label: tile.title,
      description: tile.description,
      icon: tile.icon,
      to: tile.to,
      // Karo kendi iznini taşıyorsa O geçerli (ör. Veri Aktarımı → data:import);
      // yoksa Sistem hub'ının varsayılan kapısı. Palet ile karo/route ayrışırsa
      // kullanıcı paletten tıklayıp /forbidden'a düşer.
      permission: tile.permission ?? "admin:settings",
    })),
  },
  {
    // Genel Ayarlar'ın domain kategorileri — her biri ilgili sekmeyi derin bağlantıyla açar.
    heading: "Genel Ayarlar",
    entries: SETTINGS_CATEGORIES.map((cat) => ({
      key: `setting:${cat.id}`,
      label: `Genel Ayarlar · ${cat.label}`,
      description: cat.description,
      icon: cat.icon,
      to: `/system/settings?tab=${cat.id}`,
      // Karo/route ile AYNI kapı — paletten görünüp tıklanınca /forbidden'a
      // atan bir giriş, izni olmayan kullanıcıya "yetkim varmış ama bozuk"
      // dedirtir ("Kurşun Sırası" dersi, `visibleWhen` notu).
      permissionAny: cat.permissionAny ?? [SETTINGS_ADMIN_PERMISSION],
      // Rejim yüklemi ayar ekranından TAŞINIR (kopyalanmaz): fabrikada gizli
      // olan "Muhasebe" sekmesine palet derin bağlantı vermemeli.
      visibleWhen: settingsCategoryVisibleWhen(cat),
      keywords: cat.keywords,
    })),
  },
  {
    heading: "Kişisel",
    entries: [
      {
        key: "personal:settings",
        label: "Ayarlar",
        description: "Tema, vurgu rengi, yoğunluk, favoriler ve kayıtlı görünümler",
        icon: SettingsIcon,
        to: "/settings",
        keywords: "ayar tercih tema koyu açık renk yoğunluk favori kayıtlı görünüm sıfırla kişisel profil",
      },
    ],
  },
  ...deepCommandSections,
];

/** Tüm komut girişleri düz liste — favoriler katalogu olarak da kullanılır. */
export const allCommandEntries: CommandEntry[] = commandSections.flatMap((s) => s.entries);

/**
 * Route (pathname) → komut girişi. Favori çözümleme + favori edilebilirlik kontrolü.
 *
 * ⚠️ Sıra ÖNEMLİ: aynı `to` birden çok girişte olabilir (ör. hub bölüm
 * başlıkları `/definitions`e çıkar). Üst seviye bölümler dizide önce geldiği
 * için sayfanın KENDİ girişi kazanır; `deepCommandSections` en sonda durur.
 */
export function findCommandEntry(to: string): CommandEntry | undefined {
  return allCommandEntries.find((e) => e.to === to);
}

// Bölüm başlığı → üst (hub) sayfa. Breadcrumb için: alt sayfadan hub'a dönüş.
const SECTION_PARENTS: Record<string, { label: string; to: string }> = {
  Operasyon: { label: "Operasyon", to: "/operations" },
  Yetkilendirme: { label: "Yetkilendirme", to: "/access" },
  Sistem: { label: "Sistem", to: "/system" },
};

/** Bir route'un breadcrumb üst bağlantısı (hub). Üst seviye sayfalarda null. */
export function findBreadcrumbParent(to: string): { label: string; to: string } | null {
  for (const section of commandSections) {
    if (section.entries.some((e) => e.to === to)) {
      // Bölüm kendi üstünü bildiriyorsa (ör. rapor kategorileri) o kazanır.
      // `to` bölümün üstünün TA KENDİSİYSE (kategori hub'ı) bir üst kata çıkılır.
      if (section.parent && section.parent.to !== to) return section.parent;
      if (section.heading.startsWith("Raporlar")) return { label: "Raporlar", to: "/reports" };
      if (section.heading.startsWith("Tanımlar")) return { label: "Tanımlar", to: "/definitions" };
      return SECTION_PARENTS[section.heading] ?? null;
    }
  }
  return null;
}
