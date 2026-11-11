import { navGroups, type NavItem } from "./nav-config";
import { resolveTabMeta, tabPathname } from "./tabs/tab-meta";
import { sectionTiles } from "@/pages/Operations/sections";

export interface ShellHeading {
  title: string;
  description?: string;
}

const matches = (path: string, to: string) => path === to || (to !== "/" && path.startsWith(`${to}/`));

/**
 * Yolun bağlı olduğu menü kökü. Bölüm kökleri (T5) kendi karolarının adreslerini de sahiplenir
 * (`/operations/orders` → Satış); en uzun eşleşme kazanır, "/" yalnız tam eşleşir.
 */
export function navRootFor(path: string, items: NavItem[] = navGroups.flatMap((g) => g.items)): NavItem | null {
  let best: { item: NavItem; len: number } | null = null;
  for (const item of items) {
    const targets = [item.to, ...(item.section ? sectionTiles(item.section).map((t) => t.to) : [])];
    for (const to of targets) {
      if (matches(path, to) && (!best || to.length > best.len)) best = { item, len: to.length };
    }
  }
  return best?.item ?? null;
}

/** Üst çubuk başlığı: sayfanın menü bölümü + açıklaması; menü dışı sayfada sekme başlığı. */
export function shellHeadingFor(rawPath: string | undefined): ShellHeading {
  if (!rawPath) return { title: "Anasayfa" };
  const path = tabPathname(rawPath);
  const root = navRootFor(path);
  if (root) return { title: root.label, description: root.description };
  return { title: resolveTabMeta(path).title };
}
