import type { LucideIcon } from "lucide-react";
import { navGroups } from "./nav-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { definitionGroups } from "@/pages/Definitions/groups-config";
import {
  operationsTiles,
  type OperationsVisibilityContext,
} from "@/pages/Operations/tile-config";
import { accessTiles } from "@/pages/Access/tile-config";
import { systemTiles } from "@/pages/System/tile-config";
import { SETTINGS_CATEGORIES } from "@/pages/GeneralSettings/settings-config";

export interface CommandEntry {
  key: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  to: string;
  permission?: string;
  /** Birden çok izinden HERHANGİ biri yeterli (tile permissionAny ile hizalı). */
  permissionAny?: string[];
  adminOnly?: boolean;
  /** Görünmeyen ek arama anahtarları (cmdk eşleşme değerine eklenir). */
  keywords?: string;
  /**
   * Operasyon karolarının DURUMA BAĞLI görünürlüğü (`OperationsTile.visibleWhen`
   * ile AYNI yüklem — kopyalanmaz, taşınır).
   *
   * NEDEN PALET DE SÜZÜLÜR: hub karosu gizlendiğinde palet girişi kalırsa üçüncü
   * bir giriş kapısı kuralla çelişir. "Kurşun Sırası"nda bu somut bir hataya
   * dönüşüyordu — route kapısı da aynı koşulu uyguladığı için paletten seçen
   * kullanıcı sayfa yerine hub'a atılıyor ve sebebini hiçbir yerde göremiyordu.
   * (`OperationsTile` dışındaki girişlerde bu alan yoktur → her zaman görünür.)
   */
  visibleWhen?: (ctx: OperationsVisibilityContext) => boolean;
}

export interface CommandSection {
  heading: string;
  entries: CommandEntry[];
}

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
    entries: operationsTiles.map((tile) => ({
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
  },
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
      permission: "admin:settings",
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
      permission: "admin:settings",
      keywords: cat.keywords,
    })),
  },
];

/** Tüm komut girişleri düz liste — favoriler katalogu olarak da kullanılır. */
export const allCommandEntries: CommandEntry[] = commandSections.flatMap((s) => s.entries);

/** Route (pathname) → komut girişi. Favori çözümleme + favori edilebilirlik kontrolü. */
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
      if (section.heading.startsWith("Tanımlar")) return { label: "Tanımlar", to: "/definitions" };
      return SECTION_PARENTS[section.heading] ?? null;
    }
  }
  return null;
}
