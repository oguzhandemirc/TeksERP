import { useSectionTiles } from "@/pages/Operations/useSectionTiles";
import type { NavItem } from "./nav-config";

/**
 * T5 bölüm kökleri: alt liste bölüm sayfasıyla AYNI süzgeçten (`useSectionTiles`); görünür alt öğesi yoksa
 * kök çizilmez. Bayrak yüklenene dek izinli karosu olan kök durur (modüllü karo sonradan belirir, kök titremez).
 */
export function useSectionNav() {
  const sections = useSectionTiles();
  const sectionVisible = (item: NavItem) =>
    !item.section || (sections.ready ? sections.tiles[item.section].length > 0 : sections.permitted[item.section]);
  const withChildren = (item: NavItem): NavItem =>
    item.section
      ? {
          ...item,
          children: sections.tiles[item.section].map((t) => ({
            label: t.label,
            to: t.to,
            icon: t.icon,
            offHint: t.off ? t.offHint : undefined,
          })),
        }
      : item;
  return { sectionVisible, withChildren };
}
