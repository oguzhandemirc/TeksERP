import { navGroups, type NavItem } from "./nav-config";
import { resolveTabMeta, tabPathname } from "./tabs/tab-meta";

export interface ShellHeading {
  title: string;
  description?: string;
}

/** Yolun bağlı olduğu menü kökü: tam eşleşme, yoksa en uzun ön ek ("/" yalnız tam eşleşir). */
export function navRootFor(path: string, items: NavItem[] = navGroups.flatMap((g) => g.items)): NavItem | null {
  const exact = items.find((i) => i.to === path);
  if (exact) return exact;
  return (
    items
      .filter((i) => i.to !== "/" && path.startsWith(`${i.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? null
  );
}

/** Üst çubuk başlığı: sayfanın menü bölümü + açıklaması; menü dışı sayfada sekme başlığı. */
export function shellHeadingFor(rawPath: string | undefined): ShellHeading {
  if (!rawPath) return { title: "Anasayfa" };
  const path = tabPathname(rawPath);
  const root = navRootFor(path);
  if (root) return { title: root.label, description: root.description };
  return { title: resolveTabMeta(path).title };
}
