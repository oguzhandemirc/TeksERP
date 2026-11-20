import { useSectionTiles } from "@/pages/Operations/useSectionTiles";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { isHubTileHidden } from "@/lib/menu-layout";
import { TERIM_AD } from "@/lib/terim";
import type { NavChild, NavChildGroup, NavItem } from "./nav-config";
import { commandSections } from "./command-entries";
import { useCommandEntryAccess } from "./command-entry-access";
import { layoutSubgroups } from "./nav-subgroups";

/**
 * Bölüm OLMAYAN hub köklerinin alt öğe kaynağı: komut paletinin bölüm başlığı → alt grup adı ("" = tek grup).
 * Palet kataloğu karo config'lerinden türer; alt öğe paletle AYNI süzgeçten geçer (`useCommandEntryAccess`).
 * Raporlar ve Sistem bilinçli olarak yok: kendi gezinmeleri (Rapor Merkezi · gruplu Sistem sayfası) var.
 */
const HUB_CHILD_SOURCES: Readonly<Record<string, (heading: string) => string | null>> = {
  "/quality": (h) => (h === TERIM_AD.kaliteGuvence ? "" : null),
  "/cost": (h) => (h === "Maliyet" ? "" : null),
  "/finance": (h) => (h === TERIM_AD.onMuhasebe ? "" : null),
  "/definitions": (h) => (h.startsWith("Tanımlar · ") ? h.slice("Tanımlar · ".length) : null),
  "/documents": (h) => (h === TERIM_AD.belgeler ? "" : null),
  "/access": (h) => (h === "Yetkilendirme" ? "" : null),
};

/**
 * Menü kökü alt listeleri. T5 bölümleri (Satış · Depo · Üretim · Sevkiyat) bölüm sayfasıyla AYNI süzgeçten
 * (`useSectionTiles`); görünür alt öğesi yoksa kök çizilmez, bayrak yüklenene dek izinli karosu olan kök durur.
 * Diğer hub kökleri palet süzgecinden; alt öğesi yoksa satır eski düz bağlantıdır. Alt gruplar `nav-subgroups.ts`.
 */
export function useSectionNav() {
  const sections = useSectionTiles();
  const menu = useMenuLayout();
  const { isAllowed, labelOf, visibilityCtx } = useCommandEntryAccess();

  const sectionVisible = (item: NavItem) =>
    !item.section || (sections.ready ? sections.tiles[item.section].length > 0 : sections.permitted[item.section]);

  const hubGroups = (root: string): NavChildGroup[] => {
    const source = HUB_CHILD_SOURCES[root];
    if (!source) return [];
    const seen = new Set<string>();
    const byHeading = new Map<string, NavChild[]>();
    for (const section of commandSections) {
      const label = source(section.heading);
      if (label === null) continue;
      for (const e of section.entries) {
        if (e.deep || seen.has(e.to) || isHubTileHidden(menu, e.to) || !isAllowed(e)) continue;
        seen.add(e.to);
        const list = byHeading.get(label) ?? [];
        list.push({ label: labelOf(e), to: e.to, icon: e.icon });
        byHeading.set(label, list);
      }
    }
    if (byHeading.size > 1) return [...byHeading].map(([label, children]) => ({ key: label, label, children }));
    return layoutSubgroups(root, [...byHeading.values()].flat(), visibilityCtx).map((g) => ({ key: g.key, label: g.label, children: g.items }));
  };

  const withChildren = (item: NavItem): NavItem => {
    let childGroups: NavChildGroup[];
    if (item.section) {
      childGroups = sections.groups[item.section].map((g) => ({
        key: g.key,
        label: g.label,
        children: g.items.map((t) => ({ label: t.label, to: t.to, icon: t.icon, offHint: t.off ? t.offHint : undefined })),
      }));
    } else {
      // Kapalı (soluk) kökün alt listesi açılmaz: tık yalnız ipucu verir (UX-2 K3).
      childGroups = item.offHint ? [] : hubGroups(item.to);
      if (childGroups.length === 0) return item;
    }
    return { ...item, childGroups, children: childGroups.flatMap((g) => g.children) };
  };
  return { sectionVisible, withChildren };
}
